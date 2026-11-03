"use node";

import { createHmac } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";

export const signRelay = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const instance = await ctx.runQuery(internal.relaySigning.relaySettings, args);
    return createHmac("sha256", signingKey()).update(instance?._id ?? "").digest("hex");
  },
});

export const rotate = internalAction({ args: {}, handler: async () => undefined });

function signingKey(): string {
  const key = process.env.RELAY_SIGNING_KEY;
  if (!key) {
    throw new Error("RELAY_SIGNING_KEY is not set");
  }
  return key;
}
