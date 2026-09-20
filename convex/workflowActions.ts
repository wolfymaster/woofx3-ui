import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowDefinition } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { unescapeDollarKeys } from "./lib/dollarKeys";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

const CORRELATION_TIMEOUT_MS = 10_000;
const CORRELATION_POLL_MS = 250;

/**
 * Poll the completedWorkflowOperations table for the webhook echo that
 * matches a given correlationKey. Resolves with the engineWorkflowId the
 * engine reported, or throws if the engine fails to confirm within 10s.
 */
async function waitForCompletion(ctx: ActionCtx, correlationKey: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < CORRELATION_TIMEOUT_MS) {
    const row = await ctx.runQuery(internal.workflowInternal.findCompletion, { correlationKey });
    if (row) {
      return row.engineWorkflowId;
    }
    await new Promise((r) => setTimeout(r, CORRELATION_POLL_MS));
  }
  throw new Error("Engine did not confirm the change within 10s");
}

type InstanceContext = {
  url: string;
  applicationId: string;
  clientId: string;
  clientSecret: string;
};

async function requireInstanceContext(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) {
    throw new Error("Not authorized or instance not found");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    applicationId: bundle.applicationId,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

/**
 * Create a workflow in the engine from a canonical WorkflowDefinition.
 * Waits up to 10s for the engine's webhook echo before returning, so the
 * caller receives the engine-minted id before navigating.
 */
export const createFromDefinition = action({
  args: {
    instanceId: v.id("instances"),
    definition: v.any(), // Omit<WorkflowDefinition, "id">
  },
  handler: async (ctx, { instanceId, definition }): Promise<{ engineWorkflowId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "create",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const engineDefinition = unescapeDollarKeys(definition) as Omit<WorkflowDefinition, "id">;
    await rpc.createWorkflow({
      definition: engineDefinition,
      correlationKey,
    });

    const engineWorkflowId = await waitForCompletion(ctx, correlationKey);
    return { engineWorkflowId };
  },
});

/**
 * Update an existing workflow's definition in the engine. Waits for the
 * engine's webhook echo before returning.
 */
export const updateFromDefinition = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    definition: v.any(), // WorkflowDefinition
  },
  handler: async (ctx, { instanceId, engineWorkflowId, definition }): Promise<{ engineWorkflowId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "update",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const engineDefinition = unescapeDollarKeys(definition) as WorkflowDefinition;
    await rpc.updateWorkflow(engineWorkflowId, {
      definition: engineDefinition,
      correlationKey,
    });

    const result = await waitForCompletion(ctx, correlationKey);
    return { engineWorkflowId: result };
  },
});

/**
 * Delete a workflow from the engine. Waits for the engine's webhook echo
 * before returning.
 */
export const deleteByEngineId = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }): Promise<{ deleted: true }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "delete",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.deleteWorkflow(engineWorkflowId, correlationKey);

    await waitForCompletion(ctx, correlationKey);
    return { deleted: true };
  },
});

/**
 * Ask the engine to run a workflow, matched by id or by name.
 *
 * Returns the correlation key immediately rather than waiting, unlike the CRUD
 * actions above. A run's outcome is not a webhook echo confirming a change; it
 * is a lifecycle that arrives in `transientEvents` under this key. Callers
 * subscribe with `api.transientEvents.get` and watch the run from there.
 */
export const trigger = action({
  args: {
    instanceId: v.id("instances"),
    workflowNameOrId: v.string(),
    parameters: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { instanceId, workflowNameOrId, parameters }): Promise<{ triggerId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    // Minted before the call, so a caller can subscribe to the outcome before
    // the run exists -- and so a lost response cannot strand a run whose
    // result nobody can then find.
    const triggerId = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.triggerWorkflowByName(workflowNameOrId, parameters ?? {}, undefined, triggerId, "dashboard");

    return { triggerId };
  },
});

/**
 * Run a recorded workflow run again, whole or from one of its steps.
 *
 * Returns the correlation key at once, like `trigger`. The replay's progress
 * arrives in transientEvents under it, and a refusal arrives there as a failure
 * carrying the engine's reason. A replay is fired by a person, so like any
 * manual run it is not written to the history.
 */
export const replay = action({
  args: {
    instanceId: v.id("instances"),
    engineRunId: v.string(),
    fromTaskId: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, engineRunId, fromTaskId }): Promise<{ triggerId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const triggerId = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.replayWorkflowRun(engineRunId, fromTaskId, triggerId, "dashboard");

    return { triggerId };
  },
});

/**
 * Toggle a workflow's enabled state on the engine. Waits for the engine's
 * webhook echo before returning.
 */
export const setEnabled = action({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId, isEnabled }): Promise<{ isEnabled: boolean }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const correlationKey = crypto.randomUUID();

    await ctx.runMutation(internal.workflowInternal.insertPending, {
      correlationKey,
      instanceId,
      op: "update",
      expiresAt: Date.now() + CORRELATION_TIMEOUT_MS + 5_000,
    });

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.setWorkflowEnabled(engineWorkflowId, isEnabled, correlationKey);

    await waitForCompletion(ctx, correlationKey);
    return { isEnabled };
  },
});
