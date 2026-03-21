import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("moduleRepository").collect();

    let results = all;

    if (args.tags && args.tags.length > 0) {
      results = results.filter((m) => args.tags!.some((tag) => m.tags.includes(tag)));
    }

    if (args.search) {
      const lower = args.search.toLowerCase();
      results = results.filter(
        (m) => m.name.toLowerCase().includes(lower) || m.description.toLowerCase().includes(lower)
      );
    }

    return results;
  },
});

export const get = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.moduleId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.any(),
    archiveKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return ctx.db.insert("moduleRepository", args);
  },
});
