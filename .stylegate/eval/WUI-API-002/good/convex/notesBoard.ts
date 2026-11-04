import { v } from "convex/values";
import { httpAction, internalMutation, mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";

const renameArgs = { noteId: v.id("dashboardNotes"), title: v.string() };

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return ctx.db
      .query("dashboardNotes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
  },
});

export const rename = mutation({
  args: renameArgs,
  handler: async (ctx, args) => {
    await requireUserId(ctx);
    await ctx.db.patch(args.noteId, { title: args.title });
  },
});

const args = { noteId: v.id("dashboardNotes") };

export const touch = internalMutation({
  args,
  handler: async (ctx, { noteId }) => {
    await ctx.db.patch(noteId, { touchedAt: Date.now() });
  },
});

export const exportNotes = httpAction(async (_ctx, request) => new Response(await request.text()));

const filtered = [1, 2, 3].filter((n) => n > 1);
export const count = filtered.length;
