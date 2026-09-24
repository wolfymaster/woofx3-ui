import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Which counters the dashboard command bar shows. Rows hold a reference and a
// position, never a number — see the schema comment on `dashboardCounters`.

const MAX_PINNED = 24;

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

async function findPinned(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  canonicalId: string
): Promise<Doc<"dashboardCounters"> | null> {
  return ctx.db
    .query("dashboardCounters")
    .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId).eq("canonicalId", canonicalId))
    .first();
}

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Doc<"dashboardCounters">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      return [];
    }

    const pinned = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_PINNED);
    return pinned.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/** Pins a counter to the end of the bar. Pinning one already there is a no-op, not an error. */
export const add = mutation({
  args: { instanceId: v.id("instances"), canonicalId: v.string() },
  handler: async (ctx, args): Promise<Id<"dashboardCounters"> | null> => {
    await requireMember(ctx, args.instanceId);

    const canonicalId = args.canonicalId.trim();
    if (!canonicalId) {
      throw new Error("Counter id cannot be empty");
    }

    const existing = await findPinned(ctx, args.instanceId, canonicalId);
    if (existing) {
      return existing._id;
    }

    const pinned = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_PINNED);
    if (pinned.length >= MAX_PINNED) {
      throw new Error(`The command bar holds at most ${MAX_PINNED} counters`);
    }

    const highestSortOrder = pinned.reduce((max, row) => Math.max(max, row.sortOrder), -1);
    return ctx.db.insert("dashboardCounters", {
      instanceId: args.instanceId,
      canonicalId,
      sortOrder: highestSortOrder + 1,
    });
  },
});

/** Takes a counter off the bar. The counter itself is untouched. */
export const remove = mutation({
  args: { instanceId: v.id("instances"), canonicalId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);

    const existing = await findPinned(ctx, args.instanceId, args.canonicalId);
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
