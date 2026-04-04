import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("actionDefinitions").collect();
  },
});

export const listByModule = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    return ctx.db
      .query("actionDefinitions")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
  },
});

export const upsert = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
    moduleId: v.optional(v.id("moduleRepository")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      await ctx.db.replace(existing._id, args);
    } else {
      await ctx.db.insert("actionDefinitions", args);
    }
  },
});

export const removeBySlug = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (doc) {
      await ctx.db.delete(doc._id);
    }
  },
});
