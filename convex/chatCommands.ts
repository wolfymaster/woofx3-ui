import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

const commandTypeValidator = v.union(v.literal("static"), v.literal("dynamic"), v.literal("function"));

/**
 * List all chat commands for an instance.
 */
export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    return ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(200);
  },
});

/**
 * Create a new chat command.
 */
export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    command: v.string(),
    type: commandTypeValidator,
    response: v.optional(v.string()),
    template: v.optional(v.string()),
    functionId: v.optional(v.string()),
    cooldown: v.number(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    // Ensure command starts with "!"
    const command = args.command.startsWith("!") ? args.command : `!${args.command}`;

    // Check for duplicate command name within instance
    const existing = await ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);

    if (existing.some((c) => c.command.toLowerCase() === command.toLowerCase())) {
      throw new Error(`Command "${command}" already exists`);
    }

    return ctx.db.insert("chatCommands", {
      instanceId: args.instanceId,
      command,
      type: args.type,
      response: args.response,
      template: args.template,
      functionId: args.functionId,
      cooldown: args.cooldown,
      enabled: args.enabled,
      createdAt: Date.now(),
    });
  },
});

/**
 * Update an existing chat command.
 */
export const update = mutation({
  args: {
    commandId: v.id("chatCommands"),
    command: v.optional(v.string()),
    type: v.optional(commandTypeValidator),
    response: v.optional(v.string()),
    template: v.optional(v.string()),
    functionId: v.optional(v.string()),
    cooldown: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, { commandId, ...updates }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(commandId);
    if (!existing) {
      throw new Error("Command not found");
    }

    const membership = await getInstanceMembership(ctx, existing.instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    // Normalize command name if provided
    if (updates.command) {
      updates.command = updates.command.startsWith("!") ? updates.command : `!${updates.command}`;
    }

    await ctx.db.patch(commandId, updates);
  },
});

/**
 * Delete a chat command.
 */
export const remove = mutation({
  args: { commandId: v.id("chatCommands") },
  handler: async (ctx, { commandId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(commandId);
    if (!existing) {
      throw new Error("Command not found");
    }

    const membership = await getInstanceMembership(ctx, existing.instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(commandId);
  },
});

/**
 * Toggle a command's enabled state.
 */
export const toggleEnabled = mutation({
  args: { commandId: v.id("chatCommands") },
  handler: async (ctx, { commandId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db.get(commandId);
    if (!existing) {
      throw new Error("Command not found");
    }

    const membership = await getInstanceMembership(ctx, existing.instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(commandId, { enabled: !existing.enabled });
  },
});
