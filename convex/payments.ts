import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// The payment rail's own records: provider webhooks as received. What an event
// means for a subscription is the billing lifecycle's (convex/billing.ts).

const outcomeValidator = v.union(v.literal("applied"), v.literal("ignored"), v.literal("failed"));

/**
 * Keeps a webhook as received, before anything is done with it. A delivery
 * already applied or ignored is a duplicate; one that failed is processed again.
 */
export const recordEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    rawPayload: v.string(),
    schemaVersion: v.number(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ duplicate: boolean }> => {
    const existing = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", args.eventId))
      .unique();
    if (existing !== null) {
      return { duplicate: existing.outcome === "applied" || existing.outcome === "ignored" };
    }
    await ctx.db.insert("paymentEvents", { provider: "stripe", ...args, outcome: "received" });
    return { duplicate: false };
  },
});

export const finishEvent = internalMutation({
  args: {
    eventId: v.string(),
    outcome: outcomeValidator,
    error: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, { eventId, outcome, error, accountId }) => {
    const row = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", eventId))
      .unique();
    if (row === null) {
      throw new Error(`finishEvent: payment event ${eventId} was never recorded`);
    }
    await ctx.db.patch(row._id, { outcome, error, accountId });
  },
});
