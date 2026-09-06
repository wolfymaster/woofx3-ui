import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Goal cards shown in the dashboard command bar. Values are entered and
// advanced by hand — see the schema comment on `streamGoals` for why nothing
// derives them from engine events yet.

const MAX_GOALS = 24;

async function requireMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  if (!membership) {
    throw new Error("Not a member of this instance");
  }
  return userId;
}

/** Loads a goal and proves the caller may touch it — a goal id alone says nothing about who owns it. */
async function requireOwnedGoal(ctx: MutationCtx, goalId: Id<"streamGoals">): Promise<Doc<"streamGoals">> {
  const goal = await ctx.db.get(goalId);
  if (!goal) {
    throw new Error("Goal not found");
  }
  await requireMember(ctx, goal.instanceId);
  return goal;
}

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Doc<"streamGoals">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      return [];
    }

    const goals = await ctx.db
      .query("streamGoals")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_GOALS);
    return goals.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    label: v.string(),
    target: v.number(),
    current: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"streamGoals">> => {
    await requireMember(ctx, args.instanceId);

    const label = args.label.trim();
    if (!label) {
      throw new Error("Goal label cannot be empty");
    }
    if (!Number.isFinite(args.target) || args.target <= 0) {
      throw new Error("Goal target must be a positive number");
    }

    const existing = await ctx.db
      .query("streamGoals")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_GOALS);
    if (existing.length >= MAX_GOALS) {
      throw new Error(`A dashboard can hold at most ${MAX_GOALS} goals`);
    }

    const highestSortOrder = existing.reduce((max, goal) => Math.max(max, goal.sortOrder), -1);
    return ctx.db.insert("streamGoals", {
      instanceId: args.instanceId,
      label,
      current: Math.max(0, args.current ?? 0),
      target: args.target,
      sortOrder: highestSortOrder + 1,
    });
  },
});

export const update = mutation({
  args: {
    goalId: v.id("streamGoals"),
    label: v.optional(v.string()),
    current: v.optional(v.number()),
    target: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedGoal(ctx, args.goalId);

    const patch: Partial<Pick<Doc<"streamGoals">, "label" | "current" | "target">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) {
        throw new Error("Goal label cannot be empty");
      }
      patch.label = label;
    }
    if (args.current !== undefined) {
      if (!Number.isFinite(args.current)) {
        throw new Error("Goal progress must be a number");
      }
      patch.current = Math.max(0, args.current);
    }
    if (args.target !== undefined) {
      if (!Number.isFinite(args.target) || args.target <= 0) {
        throw new Error("Goal target must be a positive number");
      }
      patch.target = args.target;
    }

    await ctx.db.patch(args.goalId, patch);
  },
});

export const remove = mutation({
  args: { goalId: v.id("streamGoals") },
  handler: async (ctx, args) => {
    await requireOwnedGoal(ctx, args.goalId);
    await ctx.db.delete(args.goalId);
  },
});
