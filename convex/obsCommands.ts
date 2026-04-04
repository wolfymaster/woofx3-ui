import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

export const getPendingCommands = internalQuery({
  args: { sceneId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const commands = await ctx.db
      .query("obsCommands")
      .withIndex("by_scene_and_state", (q) => q.eq("sceneId", args.sceneId as any).eq("state", "pending"))
      .collect();

    return commands.filter((c) => c.ttl > now);
  },
});

export const updateCommandState = internalMutation({
  args: {
    commandId: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
  },
  handler: async (ctx, args) => {
    const id = args.commandId as any;
    const existing = await ctx.db.get(id);
    if (!existing) return;

    await ctx.db.patch(id, { state: args.state });
  },
});
