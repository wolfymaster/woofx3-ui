import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { paymentsConfig } from "./lib/payments/config";
import type { PaymentProvider } from "./lib/payments/provider";
import { paymentProvider } from "./lib/payments/registry";
import { STRIPE_SCHEMA_VERSION } from "./lib/payments/stripe";
import { logger } from "./logger";

export const STRIPE_WEBHOOK_PATH = "/api/webhooks/billing/stripe";

export interface BillingWebhookDeps {
  provider: PaymentProvider;
  runMutation: ActionCtx["runMutation"];
  now: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * One provider webhook: verify it, keep it as received, fetch the
 * subscription it is about from the provider and apply that. A duplicate
 * answers 200. A failure is recorded and answers 500, so the provider
 * delivers it again.
 */
export async function handleBillingWebhook(
  deps: BillingWebhookDeps,
  rawBody: string,
  headers: Headers
): Promise<Response> {
  const verified = await deps.provider.verifyWebhook(rawBody, headers);
  if (!verified.ok) {
    logger.warn("billing webhook: rejected", { code: verified.error.code });
    return json(400, { error: verified.error });
  }
  const event = verified.value;
  const { duplicate } = await deps.runMutation(internal.billing.recordEvent, {
    eventId: event.eventId,
    type: event.type,
    rawPayload: rawBody,
    schemaVersion: STRIPE_SCHEMA_VERSION,
    receivedAt: deps.now(),
  });
  if (duplicate) {
    return json(200, { received: true, duplicate: true });
  }
  if (event.purpose !== "subscription" || event.subscriptionRef === null) {
    await deps.runMutation(internal.billing.finishEvent, { eventId: event.eventId, outcome: "ignored" });
    return json(200, { received: true });
  }
  try {
    const fetched = await deps.provider.fetchSubscription(event.subscriptionRef);
    if (!fetched.ok) {
      throw new Error(`${fetched.error.code}: ${fetched.error.message}`);
    }
    if (fetched.value === null) {
      await deps.runMutation(internal.billing.finishEvent, { eventId: event.eventId, outcome: "ignored" });
      return json(200, { received: true });
    }
    const applied = await deps.runMutation(internal.billing.applyProviderSubscription, {
      subscription: fetched.value,
    });
    await deps.runMutation(internal.billing.finishEvent, {
      eventId: event.eventId,
      outcome: applied.outcome,
      error: applied.error,
      accountId: fetched.value.accountId,
    });
    return json(200, { received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("billing webhook: failed", { eventId: event.eventId, type: event.type, error: message });
    await deps.runMutation(internal.billing.finishEvent, { eventId: event.eventId, outcome: "failed", error: message });
    return json(500, { error: { code: "failed", message } });
  }
}

export function registerBillingRoutes(http: HttpRouter): void {
  http.route({
    path: STRIPE_WEBHOOK_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      let provider: PaymentProvider;
      try {
        provider = paymentProvider(paymentsConfig());
      } catch (error) {
        logger.error("billing webhook: billing is not configured", { error: String(error) });
        return json(503, { error: { code: "not_configured", message: "Billing is not configured" } });
      }
      return handleBillingWebhook(
        { provider, runMutation: ctx.runMutation, now: Date.now },
        await request.text(),
        request.headers
      );
    }),
  });
}
