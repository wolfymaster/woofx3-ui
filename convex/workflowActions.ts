import { getAuthUserId } from "@convex-dev/auth/server";
import type { WorkflowDefinition } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { unescapeDollarKeys } from "./lib/dollarKeys";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import {
  buildTriggerOptions,
  type CancelWorkflowResult,
  classifyOptionsProbe,
  OPTIONS_PROBE_WORKFLOW,
  type OptionsSupport,
  optionsWereIgnored,
  type TestRunEngineApi,
  type UnmetTriggerCondition,
} from "./lib/engineTestRun";
import { manualRunOrigin, UNRECORDED_ORIGIN } from "./lib/manualRunOrigin";

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
 *
 * `origin` decides whether the run is written to the history; see
 * lib/manualRunOrigin.ts.
 */
export const trigger = action({
  args: {
    instanceId: v.id("instances"),
    workflowNameOrId: v.string(),
    parameters: v.optional(v.record(v.string(), v.string())),
    origin: v.optional(manualRunOrigin),
    // Test-run options; see lib/engineTestRun.ts. An engine without them
    // ignores them and runs the workflow as if none were given, which
    // `optionsIgnored` reports.
    options: v.optional(
      v.object({
        triggerData: v.optional(v.record(v.string(), v.any())),
        platform: v.optional(v.string()),
        skipConditions: v.optional(v.boolean()),
        dryRun: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, { instanceId, workflowNameOrId, parameters, origin, options }): Promise<TriggerResult> => {
    const built = buildTriggerOptions(options ?? {});
    if (!built.ok) {
      throw new Error(built.error);
    }
    const bundle = await requireInstanceContext(ctx, instanceId);
    // Minted before the call, so a caller can subscribe to the outcome before
    // the run exists -- and so a lost response cannot strand a run whose
    // result nobody can then find.
    const triggerId = crypto.randomUUID();
    const hasOptions = Object.keys(built.options).length > 0;

    const rpc = createEngineRpcSession<TestRunEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const response = await rpc.triggerWorkflowByName(
      workflowNameOrId,
      parameters ?? {},
      undefined,
      triggerId,
      origin ?? UNRECORDED_ORIGIN,
      hasOptions ? built.options : undefined
    );

    return {
      triggerId,
      status: response.status,
      executionId: response.executionId || null,
      unmetConditions: response.unmetConditions ?? [],
      dryRun: response.dryRun === true,
      optionsIgnored: optionsWereIgnored(built.options, response),
    };
  },
});

interface TriggerResult {
  triggerId: string;
  /** `requested`, `started` or `conditions_not_met`; see lib/engineTestRun.ts. */
  status: string;
  /** Set when the engine answered with the run it started. */
  executionId: string | null;
  unmetConditions: UnmetTriggerCondition[];
  dryRun: boolean;
  /** True when options were sent and the engine, predating them, ran without them. */
  optionsIgnored: boolean;
}

/**
 * Whether the instance's engine takes test-run options (sample trigger data,
 * skip conditions, dry run). The probe can start no run on any engine; see
 * `classifyOptionsProbe`.
 */
export const testRunCapabilities = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, { instanceId }): Promise<{ options: OptionsSupport }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const rpc = createEngineRpcSession<TestRunEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    try {
      await rpc.triggerWorkflowByName(OPTIONS_PROBE_WORKFLOW, {}, undefined, undefined, undefined, {
        platform: "probe",
      });
    } catch (err) {
      return { options: classifyOptionsProbe(err) };
    }
    // Only an engine that ignored the options and still found a workflow
    // could answer; neither engine can, so this is not an answer to trust.
    return { options: "unknown" };
  },
});

/**
 * Run a recorded workflow run again, whole or from one of its steps.
 *
 * Returns the correlation key at once, like `trigger`. The replay's progress
 * arrives in transientEvents under it, and a refusal arrives there as a failure
 * carrying the engine's reason. Whether the replay is written to the history
 * follows `origin`, as for `trigger`.
 */
export const replay = action({
  args: {
    instanceId: v.id("instances"),
    engineRunId: v.string(),
    fromTaskId: v.optional(v.string()),
    origin: v.optional(manualRunOrigin),
  },
  handler: async (ctx, { instanceId, engineRunId, fromTaskId, origin }): Promise<{ triggerId: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const triggerId = crypto.randomUUID();

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.replayWorkflowRun(engineRunId, fromTaskId, triggerId, origin ?? UNRECORDED_ORIGIN);

    return { triggerId };
  },
});

/**
 * Stop a recorded run.
 *
 * An engine with real cancel (wolfymaster/woofx3#172) stops the run and
 * reports its settled status back through the usual run webhooks, and answers
 * with an `outcome`. An older engine answers with nothing, having only written
 * the status onto its history row -- the remaining steps still run -- and
 * relays no webhook for it, so for that engine the Convex mirror is updated
 * here and a later snapshot from the engine still wins.
 */
export const cancelRun = action({
  args: {
    instanceId: v.id("instances"),
    engineRunId: v.string(),
  },
  handler: async (ctx, { instanceId, engineRunId }): Promise<CancelRunResult> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<TestRunEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const result: CancelWorkflowResult | undefined | null = await rpc.cancelWorkflow(
      engineRunId,
      "Cancelled from the dashboard"
    );
    if (result?.outcome) {
      return { outcome: result.outcome, status: result.status };
    }

    await ctx.runMutation(internal.workflowRuns.markCancelled, {
      instanceId,
      engineRunId,
      at: new Date().toISOString(),
    });
    return { outcome: "marked", status: "cancelled" };
  },
});

interface CancelRunResult {
  /**
   * `cancelled` / `already_finished` as the engine reported them, or `marked`
   * when an older engine only marked the history row and the steps keep running.
   */
  outcome: "cancelled" | "already_finished" | "marked";
  status: string;
}

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
