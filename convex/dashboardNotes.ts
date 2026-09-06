import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Scratch notes behind the dashboard's Notes rail widget. One row per
// (instance, user) — see the schema comment on `dashboardNotes` for why these
// are private to the author rather than shared across the account.

// Generous, but bounded: this is a scratch pad, not a document store, and an
// unbounded string field is an easy way to blow a document size limit.
const MAX_NOTE_LENGTH = 20_000;

export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<{ content: string; updatedAt: number } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      return null;
    }

    const row = await ctx.db
      .query("dashboardNotes")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!row) {
      return null;
    }
    return { content: row.content, updatedAt: row.updatedAt };
  },
});

export const save = mutation({
  args: { instanceId: v.id("instances"), content: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      throw new Error("Not a member of this instance");
    }
    if (args.content.length > MAX_NOTE_LENGTH) {
      throw new Error(`Notes are limited to ${MAX_NOTE_LENGTH} characters`);
    }

    const existing = await ctx.db
      .query("dashboardNotes")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: Date.now() });
      return;
    }
    await ctx.db.insert("dashboardNotes", {
      instanceId: args.instanceId,
      userId,
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});
