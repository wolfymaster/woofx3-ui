import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { type CheckoutPurpose, type CheckoutSession, purposeMetadata } from "./provider";

// The one writer of `paymentSessions`: a row per checkout we opened, keyed by
// the provider's session id. Convex has no unique constraints, so uniqueness
// on that id is kept here, inside each writing mutation's transaction.

export const paymentSessionStateValidator = v.union(v.literal("open"), v.literal("complete"), v.literal("expired"));

export type PaymentSession = Doc<"paymentSessions">;

export async function sessionByProviderId(ctx: QueryCtx, providerSessionId: string): Promise<PaymentSession | null> {
  return ctx.db
    .query("paymentSessions")
    .withIndex("by_provider_session", (q) => q.eq("provider", "stripe").eq("providerSessionId", providerSessionId))
    .unique();
}

/**
 * Records a checkout the provider opened. A replayed checkout (the same
 * provider session) returns the row it already has; one whose purpose differs
 * from that row's is an inconsistency, and throws.
 */
export async function recordSession(
  ctx: MutationCtx,
  { purpose, session, now }: { purpose: CheckoutPurpose; session: CheckoutSession; now: number }
): Promise<PaymentSession> {
  const existing = await sessionByProviderId(ctx, session.sessionRef);
  if (existing !== null) {
    if (JSON.stringify(existing.purpose) !== JSON.stringify(purpose)) {
      throw new Error(`Payment session ${session.sessionRef} is already recorded for another purpose`);
    }
    return existing;
  }
  const id = await ctx.db.insert("paymentSessions", {
    provider: "stripe",
    providerSessionId: session.sessionRef,
    purpose,
    ref: purposeMetadata(purpose).ref,
    state: "open",
    amountCents: session.amountCents,
    currency: "usd",
    createdAt: now,
    updatedAt: now,
  });
  const row = await ctx.db.get(id);
  if (row === null) {
    throw new Error(`Payment session ${session.sessionRef} vanished after insert`);
  }
  return row;
}

/** The open sessions for one purpose's row, such as an org's open subscription checkouts. */
export async function openSessionsFor(
  ctx: QueryCtx,
  kind: CheckoutPurpose["kind"],
  ref: string
): Promise<PaymentSession[]> {
  return ctx.db
    .query("paymentSessions")
    .withIndex("by_purpose_ref_state", (q) => q.eq("purpose.kind", kind).eq("ref", ref).eq("state", "open"))
    .take(OPEN_SESSIONS_LIMIT);
}

// One open checkout per row is the rule; a handful covers any that raced past it.
const OPEN_SESSIONS_LIMIT = 10;

/** Moves an open session to `complete` or `expired`. A session already closed is left as it is. */
export async function closeSession(
  ctx: MutationCtx,
  session: PaymentSession,
  state: "complete" | "expired",
  now: number
): Promise<{ closed: boolean }> {
  if (session.state !== "open") {
    return { closed: false };
  }
  await ctx.db.patch(session._id, { state, updatedAt: now });
  return { closed: true };
}
