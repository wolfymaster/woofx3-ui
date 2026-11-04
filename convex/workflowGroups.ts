import { getAuthUserId } from "@convex-dev/auth/server";
import { type ObjectType, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
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

const upsertFromWebhookArgs = { instanceId: v.id("instances"), ...workflowGroupFields };

/** The workflow_group.created and workflow_group.updated webhooks, and a group action's answer. */
export async function upsertWorkflowGroupFromWebhook(
  ctx: MutationCtx,
  { instanceId, ...group }: ObjectType<typeof upsertFromWebhookArgs>
): Promise<void> {
  const existing = await ctx.db
    .query("workflowGroups")
    .withIndex("by_engine_group_id", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", group.engineGroupId))
    .first();
  const now = Date.now();
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

export const upsertFromWebhook = internalMutation({
  args: upsertFromWebhookArgs,
  handler: upsertWorkflowGroupFromWebhook,
});

const deleteFromWebhookArgs = { instanceId: v.id("instances"), engineGroupId: v.string() };

/** The workflow_group.deleted webhook. Members' group lists arrive on their own workflow.updated. */
export async function deleteWorkflowGroupFromWebhook(
  ctx: MutationCtx,
  { instanceId, engineGroupId }: ObjectType<typeof deleteFromWebhookArgs>
): Promise<void> {
  const existing = await ctx.db
    .query("workflowGroups")
    .withIndex("by_engine_group_id", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

export const deleteFromWebhook = internalMutation({
  args: deleteFromWebhookArgs,
  handler: deleteWorkflowGroupFromWebhook,
});
