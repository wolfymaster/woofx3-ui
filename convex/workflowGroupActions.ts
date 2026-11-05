import type { WorkflowGroup } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceContext } from "./sceneActions";

// Workflow groups (alert groups) are engine-authoritative: each write calls
// the engine, which applies the hold and release rules, then mirrors the
// group the engine answers with, so the caller sees its own change at once.
// The members' switches arrive as their workflow.updated webhooks, which is
// what the trigger cards read; nothing waits on them.

/**
 * Opens engine sessions for the instance. It hands out an opener rather than a
 * session: an engine session is an HTTP batch sent on its first await, so one
 * returned from this async function would be spent before the real call.
 */
async function engineFor(ctx: ActionCtx, instanceId: Id<"instances">): Promise<() => EngineApi> {
  const bundle = await requireInstanceContext(ctx, instanceId);
  return () => createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
}

async function mirror(ctx: ActionCtx, instanceId: Id<"instances">, group: WorkflowGroup): Promise<WorkflowGroup> {
  await ctx.runMutation(internal.workflowGroups.upsertFromWebhook, {
    instanceId,
    engineGroupId: group.id,
    name: group.name,
    description: group.description,
    enabled: group.enabled,
    memberIds: group.memberIds,
  });
  return group;
}

export const create = action({
  args: { instanceId: v.id("instances"), name: v.string(), description: v.string() },
  handler: async (ctx, { instanceId, name, description }): Promise<WorkflowGroup> => {
    const engine = await engineFor(ctx, instanceId);
    return mirror(ctx, instanceId, await engine().createWorkflowGroup({ name, description }));
  },
});

export const update = action({
  args: { instanceId: v.id("instances"), engineGroupId: v.string(), name: v.string(), description: v.string() },
  handler: async (ctx, { instanceId, engineGroupId, name, description }): Promise<WorkflowGroup> => {
    const engine = await engineFor(ctx, instanceId);
    return mirror(ctx, instanceId, await engine().updateWorkflowGroup(engineGroupId, { name, description }));
  },
});

export const remove = action({
  args: { instanceId: v.id("instances"), engineGroupId: v.string() },
  handler: async (ctx, { instanceId, engineGroupId }): Promise<{ deleted: true }> => {
    await (await engineFor(ctx, instanceId))().deleteWorkflowGroup(engineGroupId);
    await ctx.runMutation(internal.workflowGroups.deleteFromWebhook, { instanceId, engineGroupId });
    return { deleted: true };
  },
});

export const setEnabled = action({
  args: { instanceId: v.id("instances"), engineGroupId: v.string(), enabled: v.boolean() },
  handler: async (ctx, { instanceId, engineGroupId, enabled }): Promise<WorkflowGroup> => {
    const engine = await engineFor(ctx, instanceId);
    return mirror(ctx, instanceId, await engine().setWorkflowGroupEnabled(engineGroupId, enabled));
  },
});

export const addMembers = action({
  args: { instanceId: v.id("instances"), engineGroupId: v.string(), workflowIds: v.array(v.string()) },
  handler: async (ctx, { instanceId, engineGroupId, workflowIds }): Promise<WorkflowGroup> => {
    const engine = await engineFor(ctx, instanceId);
    return mirror(ctx, instanceId, await engine().addWorkflowGroupMembers(engineGroupId, workflowIds));
  },
});

export const removeMembers = action({
  args: { instanceId: v.id("instances"), engineGroupId: v.string(), workflowIds: v.array(v.string()) },
  handler: async (ctx, { instanceId, engineGroupId, workflowIds }): Promise<WorkflowGroup> => {
    const engine = await engineFor(ctx, instanceId);
    return mirror(ctx, instanceId, await engine().removeWorkflowGroupMembers(engineGroupId, workflowIds));
  },
});
