import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Backing store for the dashboard's Activity panel: saved highlights.
// Instance-scoped and shared across everyone with access to the account —
// unlike dashboard notes, these are about the channel, not one operator.
//
// Pinning moved to convex/pins.ts when it came to mean real Twitch pinning; the
// pinnedMessages table it used is now that feature's history.

const FEED_PAGE_SIZE = 50;

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

/** Read-side membership check that yields null instead of throwing — a query that
 * throws on a not-yet-authorized render is a worse experience than an empty list. */
async function memberOrNull(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return null;
  }
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  return membership ? userId : null;
}

export const listHighlights = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Doc<"streamHighlights">[]> => {
    if (!(await memberOrNull(ctx, args.instanceId))) {
      return [];
    }
    return ctx.db
      .query("streamHighlights")
      .withIndex("by_instance_occurred_at", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(FEED_PAGE_SIZE);
  },
});

export const saveHighlight = mutation({
  args: {
    instanceId: v.id("instances"),
    kind: v.string(),
    userName: v.string(),
    detail: v.optional(v.string()),
    amount: v.optional(v.number()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"streamHighlights">> => {
    const userId = await requireMember(ctx, args.instanceId);

    const userName = args.userName.trim();
    if (!userName) {
      throw new Error("A highlight needs a name");
    }

    return ctx.db.insert("streamHighlights", {
      instanceId: args.instanceId,
      kind: args.kind,
      userName,
      detail: args.detail?.trim() || undefined,
      amount: args.amount,
      occurredAt: args.occurredAt,
      savedByUserId: userId,
    });
  },
});

export const removeHighlight = mutation({
  args: { highlightId: v.id("streamHighlights") },
  handler: async (ctx, args) => {
    const highlight = await ctx.db.get(args.highlightId);
    if (!highlight) {
      return;
    }
    await requireMember(ctx, highlight.instanceId);
    await ctx.db.delete(args.highlightId);
  },
});
