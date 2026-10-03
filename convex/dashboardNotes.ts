import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// The dashboard's Notes widget: one note per instance, shared by every member
// (see the schema comment on `instanceNotes`).

// Generous, but bounded: this is a scratch pad, not a document store, and an
// unbounded string field is an easy way to blow a document size limit.
const MAX_NOTE_LENGTH = 20_000;

export interface InstanceNote {
  content: string;
  updatedAt: number;
  /** Who saved last, so a shared note says whose edit is on screen. Null if that user is gone. */
  updatedByName: string | null;
  /** Whether the caller saved last, so the widget can leave out "edited by you". */
  updatedByMe: boolean;
}

export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<InstanceNote | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    if (!(await getInstanceMembership(ctx, args.instanceId, userId))) {
      return null;
    }

    const row = await ctx.db
      .query("instanceNotes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    if (!row) {
      return null;
    }
    const author = await ctx.db.get(row.updatedBy);
    return {
      content: row.content,
      updatedAt: row.updatedAt,
      updatedByName: author?.name ?? null,
      updatedByMe: row.updatedBy === userId,
    };
  },
});

/** Replaces the instance's note. Last write wins; the widget shows whose that was. */
export const save = mutation({
  args: { instanceId: v.id("instances"), content: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    if (!(await getInstanceMembership(ctx, args.instanceId, userId))) {
      throw new Error("Not a member of this instance");
    }
    if (args.content.length > MAX_NOTE_LENGTH) {
      throw new Error(`Notes are limited to ${MAX_NOTE_LENGTH} characters`);
    }

    const existing = await ctx.db
      .query("instanceNotes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    const fields = { content: args.content, updatedAt: Date.now(), updatedBy: userId };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return;
    }
    await ctx.db.insert("instanceNotes", { instanceId: args.instanceId, ...fields });
  },
});
