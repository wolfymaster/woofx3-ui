import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Workflow groups (alert groups) are engine-authoritative. This table is a
// read cache written by convex/workflowGroupActions.ts (from the RPC's own
// answer), by the workflow_group.* webhooks, and by the "workflowGroups"
// engine-sync step. There are no public writes here; they go through the
// engine, which owns the hold and release rules.

/** The most groups a list returns; an instance has a handful. */
const MAX_GROUPS = 500;

export const workflowGroupFields = {
  engineGroupId: v.string(),
  name: v.string(),
  description: v.string(),
  enabled: v.boolean(),
  memberIds: v.array(v.string()),
};

export interface WorkflowGroupFields {
  engineGroupId: string;
  name: string;
  description: string;
  enabled: boolean;
  memberIds: string[];
}

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Doc<"workflowGroups">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }
    return ctx.db
      .query("workflowGroups")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_GROUPS);
  },
});

export async function upsertWorkflowGroup(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  group: WorkflowGroupFields,
  now: number
): Promise<void> {
  const existing = await ctx.db
    .query("workflowGroups")
    .withIndex("by_engine_group_id", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", group.engineGroupId))
    .first();
  const fields = {
    name: group.name,
    description: group.description,
    enabled: group.enabled,
    memberIds: group.memberIds,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    return;
  }
  await ctx.db.insert("workflowGroups", {
    instanceId,
    engineGroupId: group.engineGroupId,
    ...fields,
    createdAt: now,
  });
}

/** The workflow_group.created and workflow_group.updated webhooks, and a group action's answer. */
export const upsertFromWebhook = internalMutation({
  args: { instanceId: v.id("instances"), ...workflowGroupFields },
  handler: async (ctx, { instanceId, ...group }) => {
    await upsertWorkflowGroup(ctx, instanceId, group, Date.now());
  },
});

/** The workflow_group.deleted webhook. Members' group lists arrive on their own workflow.updated. */
export const deleteFromWebhook = internalMutation({
  args: { instanceId: v.id("instances"), engineGroupId: v.string() },
  handler: async (ctx, { instanceId, engineGroupId }) => {
    const existing = await ctx.db
      .query("workflowGroups")
      .withIndex("by_engine_group_id", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
