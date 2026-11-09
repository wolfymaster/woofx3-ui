import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { checkoutPurposeValidator, strayPaymentValidator } from "./lib/payments/provider";
import {
  closeSession,
  openSessionsFor,
  type PaymentSession,
  recordSession,
  sessionByProviderId,
} from "./lib/payments/sessions";

// The payment rail's own records: provider webhooks as received, and the
// checkout sessions we opened. What a payment means for a subscription is the
// billing lifecycle's (convex/billing.ts).

const outcomeValidator = v.union(v.literal("applied"), v.literal("ignored"), v.literal("stray"), v.literal("failed"));

/**
 * Keeps a webhook as received, before anything is done with it. A delivery
 * already processed is a duplicate; one that failed is processed again.
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
      return { duplicate: existing.outcome !== "received" && existing.outcome !== "failed" };
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
    stray: v.optional(strayPaymentValidator),
  },
  handler: async (ctx, { eventId, outcome, error, accountId, stray }) => {
    if ((outcome === "stray") !== (stray !== undefined)) {
      throw new Error(`finishEvent: payment event ${eventId} is ${outcome} with${stray ? "" : "out"} stray details`);
    }
    const row = await ctx.db
      .query("paymentEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", eventId))
      .unique();
    if (row === null) {
      throw new Error(`finishEvent: payment event ${eventId} was never recorded`);
    }
    await ctx.db.patch(row._id, { outcome, error, accountId, stray });
  },
});

/**
 * Records a checkout the provider opened, and returns the other sessions
 * still open for the same purpose and row, which the caller expires so that
 * only the newest can be paid. `open` is false when the provider replayed a
 * session that has closed since, whose URL must not be handed out.
 */
export const recordCheckout = internalMutation({
  args: {
    purpose: checkoutPurposeValidator,
    session: v.object({ url: v.string(), sessionRef: v.string(), amountCents: v.number() }),
    now: v.number(),
  },
  handler: async (ctx, { purpose, session, now }): Promise<{ open: boolean; supersededSessionRefs: string[] }> => {
    const recorded = await recordSession(ctx, { purpose, session, now });
    if (recorded.state !== "open") {
      return { open: false, supersededSessionRefs: [] };
    }
    const open = await openSessionsFor(ctx, purpose.kind, recorded.ref);
    return {
      open: true,
      supersededSessionRefs: open
        .filter((other) => other.providerSessionId !== recorded.providerSessionId)
        .map((other) => other.providerSessionId),
    };
  },
});

export const sessionForEvent = internalQuery({
  args: { providerSessionId: v.string() },
  handler: async (ctx, { providerSessionId }): Promise<PaymentSession | null> =>
    sessionByProviderId(ctx, providerSessionId),
});

/** Marks a session closed unpaid. An unknown or already closed session changes nothing. */
export const expireSession = internalMutation({
  args: { providerSessionId: v.string(), now: v.number() },
  handler: async (ctx, { providerSessionId, now }): Promise<{ outcome: "applied" | "ignored"; error?: string }> => {
    const session = await sessionByProviderId(ctx, providerSessionId);
    if (session === null) {
      return { outcome: "ignored", error: "no session of ours" };
    }
    const { closed } = await closeSession(ctx, session, "expired", now);
    return closed ? { outcome: "applied" } : { outcome: "ignored", error: `session already ${session.state}` };
  },
});
