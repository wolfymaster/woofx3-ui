import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Backing store for the dashboard's Activity panel: pinned notes and saved
// highlights. Both are instance-scoped and shared across everyone with access
// to the account — unlike dashboard notes, these are about the channel, not
// about one operator.

const FEED_PAGE_SIZE = 50;
const MAX_CONTENT_LENGTH = 2_000;

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

export const listPinned = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Doc<"pinnedMessages">[]> => {
    if (!(await memberOrNull(ctx, args.instanceId))) {
      return [];
    }
    return ctx.db
      .query("pinnedMessages")
      .withIndex("by_instance_pinned_at", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(FEED_PAGE_SIZE);
  },
});

export const pin = mutation({
  args: {
    instanceId: v.id("instances"),
    content: v.string(),
    authorName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"pinnedMessages">> => {
    const userId = await requireMember(ctx, args.instanceId);

    const content = args.content.trim();
    if (!content) {
      throw new Error("A pinned message needs some text");
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Pinned messages are limited to ${MAX_CONTENT_LENGTH} characters`);
    }
    const authorName = args.authorName?.trim();

    return ctx.db.insert("pinnedMessages", {
      instanceId: args.instanceId,
      content,
      authorName: authorName || undefined,
      pinnedAt: Date.now(),
      pinnedByUserId: userId,
    });
  },
});

export const unpin = mutation({
  args: { messageId: v.id("pinnedMessages") },
  handler: async (ctx: MutationCtx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return;
    }
    await requireMember(ctx, message.instanceId);
    await ctx.db.delete(args.messageId);
  },
});

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
