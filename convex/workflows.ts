import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { RpcTarget } from "capnweb";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { getInstanceMembership } from "./lib/teamAccess";

/** Engine RPC surface for workflow CRUD (see woofx3 api/src/api.ts). */
interface WorkflowEngineRpc extends RpcTarget {
  createWorkflow(data: {
    name: string;
    description?: string;
    accountId: string;
    isEnabled?: boolean;
    steps?: unknown[];
    trigger?: unknown;
  }): Promise<unknown>;
  updateWorkflow(
    id: string,
    data: {
      name?: string;
      description?: string;
      isEnabled?: boolean;
      steps?: unknown[];
      trigger?: unknown;
    },
  ): Promise<unknown>;
  deleteWorkflow(id: string): Promise<unknown>;
}

/**
 * List all workflows for an instance (Convex-side UI state: nodes, edges, metadata).
 */
export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    return ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(100);
  },
});

/**
 * Get a single workflow by its Convex ID.
 */
export const get = query({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    return ctx.db.get(id);
  },
});

/**
 * Create a new workflow record in Convex (UI state only — not yet synced to engine).
 */
export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    description: v.optional(v.string()),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
  },
  handler: async (ctx, { instanceId, name, description, nodes, edges }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    return ctx.db.insert("workflows", {
      instanceId,
      name,
      description,
      isEnabled: false,
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Patch a workflow record in Convex. Only provided fields are updated.
 */
export const update = mutation({
  args: {
    id: v.id("workflows"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isEnabled: v.optional(v.boolean()),
    nodes: v.optional(v.array(v.any())),
    edges: v.optional(v.array(v.any())),
    engineWorkflowId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Workflow not found");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (fields.name !== undefined) {
      patch.name = fields.name;
    }
    if (fields.description !== undefined) {
      patch.description = fields.description;
    }
    if (fields.isEnabled !== undefined) {
      patch.isEnabled = fields.isEnabled;
    }
    if (fields.nodes !== undefined) {
      patch.nodes = fields.nodes;
    }
    if (fields.edges !== undefined) {
      patch.edges = fields.edges;
    }
    if (fields.engineWorkflowId !== undefined) {
      patch.engineWorkflowId = fields.engineWorkflowId;
    }

    await ctx.db.patch(id, patch);
    return null;
  },
});

/**
 * Delete a workflow from Convex. Does NOT remove it from the engine.
 */
export const remove = mutation({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Workflow not found");
    }

    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Sync a Convex workflow to the woofx3 engine.
 *
 * Reads the workflow's nodes/edges, builds the engine execution payload,
 * and creates or updates the workflow on the engine side. Saves the
 * engine-returned workflow ID back to Convex.
 */
export const syncToEngine = action({
  args: { workflowId: v.id("workflows") },
  handler: async (
    ctx,
    { workflowId },
  ): Promise<{ status: string; engineWorkflowId: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const wf = await ctx.runQuery(api.workflows.get, { id: workflowId });
    if (!wf) {
      throw new Error("Workflow not found");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId: wf.instanceId,
      userId,
    });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const rpc = createEngineRpcSession<WorkflowEngineRpc>(bundle.url, bundle.clientId, bundle.clientSecret);

    if (wf.engineWorkflowId) {
      console.log(
        `[syncToEngine] Updating engine workflow "${wf.engineWorkflowId}" for Convex workflow "${workflowId}"`,
      );
      await rpc.updateWorkflow(wf.engineWorkflowId, {
        name: wf.name,
        description: wf.description ?? "",
        isEnabled: wf.isEnabled,
        steps: wf.nodes as unknown[],
      });
      return { status: "updated", engineWorkflowId: wf.engineWorkflowId };
    }

    console.log(
      `[syncToEngine] Creating engine workflow for Convex workflow "${workflowId}"`,
    );
    const result = (await rpc.createWorkflow({
      name: wf.name,
      description: wf.description ?? "",
      accountId: wf.instanceId,
      isEnabled: wf.isEnabled,
      steps: wf.nodes as unknown[],
    })) as { id?: string } | null;

    const engineWorkflowId = result?.id ?? null;
    if (engineWorkflowId) {
      await ctx.runMutation(api.workflows.update, {
        id: workflowId,
        engineWorkflowId,
      });
    }

    return { status: "created", engineWorkflowId };
  },
});
