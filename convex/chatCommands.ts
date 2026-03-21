import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .order("asc")
      .collect();
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    command: v.string(),
    type: v.union(
      v.literal("static"),
      v.literal("dynamic"),
      v.literal("function")
    ),
    response: v.optional(v.string()),
    template: v.optional(v.string()),
    functionId: v.optional(v.string()),
    cooldown: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return ctx.db.insert("chatCommands", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    commandId: v.id("chatCommands"),
    command: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("static"),
        v.literal("dynamic"),
        v.literal("function")
      )
    ),
    response: v.optional(v.string()),
    template: v.optional(v.string()),
    functionId: v.optional(v.string()),
    cooldown: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { commandId, ...updates } = args;
    await ctx.db.patch(commandId, updates);
  },
});

export const remove = mutation({
  args: { commandId: v.id("chatCommands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.delete(args.commandId);
  },
});
