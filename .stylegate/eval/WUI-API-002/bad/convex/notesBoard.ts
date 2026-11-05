import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

export const listMine = query({
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return ctx.db
      .query("dashboardNotes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
  },
});

export const touch = internalMutation(async (ctx, { noteId }: { noteId: Id<"dashboardNotes"> }) => {
  await ctx.db.patch(noteId, { touchedAt: Date.now() });
});

export const rename = internalMutation({
  args: { noteId: v.id("dashboardNotes"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, { title: args.title });
  },
});
