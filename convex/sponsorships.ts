import { v } from "convex/values";
import { action } from "./_generated/server";
import { billingConvexError, requireClient, requireUser, unwrap } from "./billingCommands";
import { spendActionLimit } from "./lib/actionRateLimits";
import {
  type CheckoutState,
  type Sponsorship,
  type SponsorshipTerms,
  sponsorshipCheckoutIdempotencyKey,
} from "./lib/billingClient";

// What a signed-in person does with their own sponsorship. Every action
// derives the user from the session and takes no user id from the caller; the
// plane owns the data and the provider, Convex stores nothing.

const intervalValidator = v.union(v.literal("month"), v.literal("once"));

/**
 * The page the provider returns the sponsor to; the plane adds the outcome
 * (`sponsorship=done&sponsorshipCheckout=<id>` or `sponsorship=cancelled`).
 * Built from the deployment's own origin, so a caller cannot choose where the
 * sponsor lands.
 */
const RETURN_PATH = "/account";

/** Marks the card-update return; the Plan page reads it as `PAYMENT_METHOD_RETURN_KEY` in sponsorship-return.ts. */
const PAYMENT_METHOD_RETURN_QUERY = "?sponsorshipPaymentMethod=returned";

function returnUrl(query = ""): string {
  const siteUrl = process.env.SITE_URL;
  let origin: string;
  try {
    origin = new URL(siteUrl ?? "").origin;
  } catch {
    throw billingConvexError({ code: "not_configured", message: "SITE_URL is not a valid origin." });
  }
  return `${origin}${RETURN_PATH}${query}`;
}

function assertAmount(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw billingConvexError({ code: "invalid_sponsorship_amount", message: "Not a positive whole number of cents." });
  }
}

/** The plane's limits on an amount, for the confirm screen's validation. */
export const terms = action({
  args: {},
  handler: async (ctx): Promise<SponsorshipTerms> => {
    await requireUser(ctx);
    return unwrap(await requireClient().sponsorshipTerms());
  },
});

/** The viewer's sponsorships, newest first, with their payments. */
export const mine = action({
  args: {},
  handler: async (ctx): Promise<Sponsorship[]> => {
    const userId = await requireUser(ctx);
    return unwrap(await requireClient().listSponsorships(userId));
  },
});

/** A checkout for a new sponsorship; the browser goes to the returned `url`. */
export const start = action({
  args: { amountCents: v.number(), interval: intervalValidator },
  handler: async (ctx, { amountCents, interval }): Promise<{ url: string; checkoutId: string }> => {
    const userId = await requireUser(ctx);
    assertAmount(amountCents);
    await spendActionLimit(ctx, "sponsorshipStart", userId);
    const request = { userId, amountCents, interval };
    return unwrap(
      await requireClient().startSponsorshipCheckout({
        ...request,
        returnUrl: returnUrl(),
        idempotencyKey: sponsorshipCheckoutIdempotencyKey(request, Date.now()),
      })
    );
  },
});

/** Monthly sponsorships only; the plane answers a one-time one `sponsorship_not_recurring`. */
export const changeAmount = action({
  args: { sponsorshipId: v.string(), amountCents: v.number() },
  handler: async (ctx, { sponsorshipId, amountCents }): Promise<null> => {
    const userId = await requireUser(ctx);
    assertAmount(amountCents);
    return unwrap(await requireClient().changeSponsorshipAmount(userId, sponsorshipId, amountCents));
  },
});

/** A sponsor's cancel always ends at the end of the paid period; stopping one sooner is an operator action. */
export const cancel = action({
  args: { sponsorshipId: v.string() },
  handler: async (ctx, { sponsorshipId }): Promise<null> => {
    const userId = await requireUser(ctx);
    return unwrap(await requireClient().cancelSponsorship(userId, sponsorshipId, true));
  },
});

/** A provider page to replace the card on a monthly sponsorship. */
export const paymentMethodSession = action({
  args: { sponsorshipId: v.string() },
  handler: async (ctx, { sponsorshipId }): Promise<{ url: string }> => {
    const userId = await requireUser(ctx);
    return unwrap(
      await requireClient().sponsorshipPaymentMethodSession(
        userId,
        sponsorshipId,
        returnUrl(PAYMENT_METHOD_RETURN_QUERY)
      )
    );
  },
});

/**
 * Where one of the viewer's checkouts stands, for the page they return to. The plane answers another person's
 * checkout as `checkout_not_found`.
 */
export const checkoutState = action({
  args: { checkoutId: v.string() },
  handler: async (ctx, { checkoutId }): Promise<{ state: CheckoutState }> => {
    const userId = await requireUser(ctx);
    const view = unwrap(await requireClient().sponsorshipCheckoutState(checkoutId, userId));
    return { state: view.state };
  },
});
