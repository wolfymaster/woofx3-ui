import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, httpAction } from "./_generated/server";
import { paymentsConfig } from "./lib/payments/config";
import type {
  PaymentEvent,
  PaymentProvider,
  PaymentPurposeKind,
  SessionChange,
  StrayPayment,
} from "./lib/payments/provider";
import { paymentProvider } from "./lib/payments/registry";
import type { PaymentSession } from "./lib/payments/sessions";
import { STRIPE_SCHEMA_VERSION } from "./lib/payments/stripe";
import { logger } from "./logger";

export const STRIPE_WEBHOOK_PATH = "/payments/stripe/webhook";

export interface PaymentWebhookDeps {
  provider: PaymentProvider;
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
  now: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * One provider webhook: verify it, keep it as received, and route it. An
 * event about a checkout session goes by our `paymentSessions` row for it,
 * never the event's metadata; any other event goes by its purpose. A
 * duplicate answers 200. A failure is recorded and answers 500, so the
 * provider delivers it again.
 */
export async function handlePaymentWebhook(
  deps: PaymentWebhookDeps,
  rawBody: string,
  headers: Headers
): Promise<Response> {
  const verified = await deps.provider.verifyWebhook(rawBody, headers);
  if (!verified.ok) {
    logger.warn("payments webhook: rejected", { code: verified.error.code });
    return json(400, { error: verified.error });
  }
  const event = verified.value;
  const { duplicate } = await deps.runMutation(internal.payments.recordEvent, {
    eventId: event.eventId,
    type: event.type,
    rawPayload: rawBody,
    schemaVersion: STRIPE_SCHEMA_VERSION,
    receivedAt: deps.now(),
  });
  if (duplicate) {
    return json(200, { received: true, duplicate: true });
  }
  if (event.purpose === null) {
    await deps.runMutation(internal.payments.finishEvent, {
      eventId: event.eventId,
      outcome: "ignored",
      error: "no purpose of ours",
    });
    return json(200, { received: true });
  }
  try {
    const result =
      event.session === null
        ? await PURPOSE_HANDLERS[event.purpose].onEvent(deps, event)
        : await applySessionChange(deps, event, event.session);
    await deps.runMutation(internal.payments.finishEvent, { eventId: event.eventId, ...result });
    return json(200, { received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("payments webhook: failed", { eventId: event.eventId, type: event.type, error: message });
    await deps.runMutation(internal.payments.finishEvent, {
      eventId: event.eventId,
      outcome: "failed",
      error: message,
    });
    // The detail stays in paymentEvents and the log; the provider only needs to know to redeliver.
    return json(500, { error: { code: "failed", message: "The event could not be applied; it will be retried" } });
  }
}

/**
 * What applying one event did; "stray" is money we hold no grant for, for an
 * operator to settle. A handler throws for a failure worth the provider's
 * redelivery.
 */
interface EventOutcome {
  outcome: "applied" | "ignored" | "stray";
  error?: string;
  accountId?: Id<"accounts">;
  /** Set exactly when the outcome is "stray". */
  stray?: StrayPayment;
}

interface PurposeHandler {
  /** Grants what an open session of this purpose was paid for, and completes it. */
  onSessionPaid: (deps: PaymentWebhookDeps, event: PaymentEvent, session: PaymentSession) => Promise<EventOutcome>;
  /** Any other event about an object of this purpose. */
  onEvent: (deps: PaymentWebhookDeps, event: PaymentEvent) => Promise<EventOutcome>;
}

/**
 * How each purpose's events are applied: a session's by the purpose on our
 * row for it, any other by the purpose stamped on the object it is about. An
 * event without one of these is acknowledged and ignored.
 */
const PURPOSE_HANDLERS: Record<PaymentPurposeKind, PurposeHandler> = {
  subscription: { onSessionPaid: completeSubscriptionCheckout, onEvent: applySubscriptionEvent },
};

/**
 * Applies what happened to a checkout session we opened. A session with no
 * row of ours is acknowledged and ignored, and one already closed changes
 * nothing.
 */
async function applySessionChange(
  deps: PaymentWebhookDeps,
  event: PaymentEvent,
  change: SessionChange
): Promise<EventOutcome> {
  const session = await deps.runQuery(internal.payments.sessionForEvent, { providerSessionId: change.sessionRef });
  if (session === null) {
    return { outcome: "ignored", error: "no session of ours" };
  }
  switch (change.change) {
    case "expired":
      return deps.runMutation(internal.payments.expireSession, {
        providerSessionId: change.sessionRef,
        now: deps.now(),
      });
    case "awaiting_payment":
      return { outcome: "ignored", error: "completed, awaiting a delayed payment" };
    case "paid":
      if (session.state !== "open") {
        return { outcome: "ignored", error: `session already ${session.state}` };
      }
      return PURPOSE_HANDLERS[session.purpose.kind].onSessionPaid(deps, event, session);
  }
}

/** Fetches the subscription a paid checkout bought and binds it to the checkout's org. */
async function completeSubscriptionCheckout(
  deps: PaymentWebhookDeps,
  event: PaymentEvent,
  session: PaymentSession
): Promise<EventOutcome> {
  if (event.subscriptionRef === null) {
    throw new Error(`Paid subscription checkout ${session.providerSessionId} names no subscription`);
  }
  const fetched = await deps.provider.fetchSubscription(event.subscriptionRef);
  if (!fetched.ok) {
    throw new Error(`${fetched.error.code}: ${fetched.error.message}`);
  }
  if (fetched.value === null) {
    // Paid, yet not active: redelivery tries again once the provider has caught up.
    throw new Error(
      `Subscription ${event.subscriptionRef} of paid checkout ${session.providerSessionId} is incomplete`
    );
  }
  return deps.runMutation(internal.billing.completeSubscriptionCheckout, {
    providerSessionId: session.providerSessionId,
    subscription: fetched.value,
    now: deps.now(),
  });
}

/** Fetches the subscription the event is about and applies the provider's truth about it. */
async function applySubscriptionEvent(deps: PaymentWebhookDeps, event: PaymentEvent): Promise<EventOutcome> {
  if (event.subscriptionRef === null) {
    return { outcome: "ignored", error: "about no subscription" };
  }
  const fetched = await deps.provider.fetchSubscription(event.subscriptionRef);
  if (!fetched.ok) {
    throw new Error(`${fetched.error.code}: ${fetched.error.message}`);
  }
  if (fetched.value === null) {
    return { outcome: "ignored", error: "nothing to apply: still incomplete, or not a subscription of ours" };
  }
  return deps.runMutation(internal.billing.applyProviderSubscription, { subscription: fetched.value });
}

export function registerPaymentRoutes(http: HttpRouter): void {
  http.route({
    path: STRIPE_WEBHOOK_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      let provider: PaymentProvider;
      try {
        provider = paymentProvider(paymentsConfig());
      } catch (error) {
        logger.error("payments webhook: payments are not configured", { error: String(error) });
        return json(503, { error: { code: "not_configured", message: "Payments are not configured" } });
      }
      return handlePaymentWebhook(
        { provider, runQuery: ctx.runQuery, runMutation: ctx.runMutation, now: Date.now },
        await request.text(),
        request.headers
      );
    }),
  });
}
