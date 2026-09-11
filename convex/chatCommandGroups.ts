import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";

// Chat command groups ("user groups"/roles) are engine-authoritative (see
// docs/services/commands-ui.md in the woofx3 engine repo). This table is a
// read cache populated by convex/chatCommandActions.ts (immediately, from the
// RPC's own response) and by the group.* webhooks / the periodic engine-sync
// "groups" step (for changes made elsewhere). There are intentionally NO
// public create/update/delete mutations here — writes go through
// chatCommandActions.ts → engine RPC.

async function membershipFor(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<Doc<"instanceMembers"> | null> {
  return await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    return ctx.db
      .query("chatCommandGroups")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(500);
  },
});

/**
 * Live roster for a single group. Powers the membership editor — no
 * pagination, matching the engine's `listGroupMembers` contract (full roster,
 * no streamed variant).
 */
export const listMembers = query({
  args: { instanceId: v.id("instances"), engineGroupId: v.string() },
  handler: async (ctx, { instanceId, engineGroupId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    const rows = await ctx.db
      .query("chatCommandGroupMembers")
      .withIndex("by_group", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId))
      .collect();
    return rows.map((r) => r.username);
  },
});

// Populated by convex/chatCommandActions.ts (own RPC response) and the
// group.created / group.updated webhooks.
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineGroupId: v.string(),
    name: v.string(),
    description: v.string(),
    isBuiltIn: v.optional(v.boolean()),
    engineCreatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatCommandGroups")
      .withIndex("by_engine_group_id", (q) =>
        q.eq("instanceId", args.instanceId).eq("engineGroupId", args.engineGroupId)
      )
      .first();

    const fields = {
      applicationId: args.applicationId,
      name: args.name,
      description: args.description,
      isBuiltIn: args.isBuiltIn ?? false,
      engineCreatedAt: args.engineCreatedAt,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("chatCommandGroups", {
        instanceId: args.instanceId,
        engineGroupId: args.engineGroupId,
        ...fields,
        createdAt: Date.now(),
      });
    }
  },
});

// Populated by convex/chatCommandActions.ts and the group.deleted webhook.
// Also drops the group's cached membership rows.
export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
  },
  handler: async (ctx, { instanceId, engineGroupId }) => {
    const existing = await ctx.db
      .query("chatCommandGroups")
      .withIndex("by_engine_group_id", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }

    const members = await ctx.db
      .query("chatCommandGroupMembers")
      .withIndex("by_group", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId))
      .collect();
    for (const m of members) {
      await ctx.db.delete(m._id);
    }
  },
});

// Populated by convex/chatCommandActions.ts and the group.member_added webhook.
export const addMemberFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    username: v.string(),
  },
  handler: async (ctx, { instanceId, engineGroupId, username }) => {
    const existing = await ctx.db
      .query("chatCommandGroupMembers")
      .withIndex("by_group_username", (q) =>
        q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId).eq("username", username)
      )
      .first();
    if (!existing) {
      await ctx.db.insert("chatCommandGroupMembers", { instanceId, engineGroupId, username });
    }
  },
});

// Populated by convex/chatCommandActions.ts and the group.member_removed webhook.
export const removeMemberFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineGroupId: v.string(),
    username: v.string(),
  },
  handler: async (ctx, { instanceId, engineGroupId, username }) => {
    const existing = await ctx.db
      .query("chatCommandGroupMembers")
      .withIndex("by_group_username", (q) =>
        q.eq("instanceId", instanceId).eq("engineGroupId", engineGroupId).eq("username", username)
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
