import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("moduleWidgets").collect();
  },
});

export const listByModule = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("moduleWidgets")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
  },
});

export const get = query({
  args: { widgetId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();
  },
});

export const register = mutation({
  args: {
    moduleId: v.id("moduleRepository"),
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    settings: v.array(
      v.object({
        key: v.string(),
        fieldType: v.string(),
        label: v.string(),
        defaultValue: v.any(),
        options: v.optional(
          v.array(
            v.object({
              label: v.string(),
              value: v.string(),
            })
          )
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        directory: args.directory,
        description: args.description,
        alertTypes: args.alertTypes,
        settings: args.settings,
      });
      return existing._id;
    }

    return await ctx.db.insert("moduleWidgets", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const unregister = internalMutation({
  args: { widgetId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const registerFromWebhook = internalMutation({
  args: {
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    settings: v.array(
      v.object({
        key: v.string(),
        fieldType: v.string(),
        label: v.string(),
        defaultValue: v.any(),
        options: v.optional(
          v.array(
            v.object({
              label: v.string(),
              value: v.string(),
            })
          )
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        directory: args.directory,
        description: args.description,
        alertTypes: args.alertTypes,
        settings: args.settings,
      });
    } else {
      await ctx.db.insert("moduleWidgets", {
        moduleId: undefined as any,
        widgetId: args.widgetId,
        name: args.name,
        directory: args.directory,
        description: args.description,
        alertTypes: args.alertTypes,
        settings: args.settings,
        createdAt: Date.now(),
      });
    }
  },
});
