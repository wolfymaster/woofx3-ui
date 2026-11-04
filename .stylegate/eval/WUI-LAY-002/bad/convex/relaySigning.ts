"use node";

import { createHmac } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";

export const relaySettings = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => ctx.db.get(args.instanceId),
});

export const signRelay = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const instance = await ctx.runQuery(internal.relaySigning.relaySettings, args);
    return createHmac("sha256", process.env.RELAY_SIGNING_KEY ?? "").update(instance?._id ?? "").digest("hex");
  },
});
