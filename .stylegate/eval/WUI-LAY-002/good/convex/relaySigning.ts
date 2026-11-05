import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";

export const relaySettings = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => ctx.db.get(args.instanceId),
});

export const ping = action({
  args: { url: v.string() },
  handler: async (_ctx, args) => (await fetch(args.url)).ok,
});
