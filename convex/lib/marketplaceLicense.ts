/**
 * The marketplace's `acquire` answer, as the install flow reads it.
 *
 * Acquire is what makes an account hold a listing: it claims a free one,
 * confirms one already held, and answers with the license key the engine
 * downloads with; a listing that costs money answers 402 with the purchase
 * intent to pay. The browser runs the install flow on these outcomes, so each
 * marketplace answer maps to exactly one of them here.
 *
 * A license key is a credential: it travels from the marketplace through this
 * deployment to the browser and on to the engine, and is never logged or
 * stored on the way.
 */

import { MarketplaceError } from "./marketplaceApi";

export interface MarketplaceLicense {
  key: string;
  listingId: string;
  edition: number;
}

/** What the marketplace asks to be paid before the account holds a listing. `expiresAt` is ISO 8601. */
export interface MarketplacePurchaseIntent {
  id: string;
  amountCents: number;
  currency: string;
  kind: "full" | "upgrade";
  expiresAt: string;
}

export type AcquireRefusalReason =
  | "account_required"
  | "entitlement_revoked"
  | "downloads_blocked"
  | "listing_unavailable"
  | "not_found"
  | "rate_limited";

export type AcquireForInstallResult =
  | { status: "licensed"; license: MarketplaceLicense }
  | { status: "payment_required"; intent: MarketplacePurchaseIntent }
  /** Nobody may acquire it for this account now. `message` is written for the streamer. */
  | { status: "refused"; reason: AcquireRefusalReason; message: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * A 200 or 201 from acquire. Throws on an answer without a license: a
 * marketplace too old to issue keys cannot serve this flow, and installing
 * without the key it promised would hide that.
 */
export function licensedFromAcquire(payload: unknown): AcquireForInstallResult {
  const body = asRecord(payload);
  const license = asRecord(body.license);
  const key = nonEmptyString(license.key);
  const listingId = nonEmptyString(license.listingId);
  const edition = license.edition;
  if (body.entitled !== true || key === null || listingId === null) {
    throw new Error("The marketplace answered acquire without a license");
  }
  if (typeof edition !== "number" || !Number.isInteger(edition) || edition < 1) {
    throw new Error("The marketplace answered acquire with a license for no edition");
  }
  return { status: "licensed", license: { key, listingId, edition } };
}

function purchaseIntentOf(body: unknown): MarketplacePurchaseIntent | null {
  const intent = asRecord(asRecord(body).intent);
  const id = nonEmptyString(intent.id);
  const currency = nonEmptyString(intent.currency);
  const expiresAt = nonEmptyString(intent.expiresAt);
  const { amountCents, kind } = intent;
  if (id === null || currency === null || expiresAt === null) {
    return null;
  }
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
    return null;
  }
  if (kind !== "full" && kind !== "upgrade") {
    return null;
  }
  return { id, amountCents, currency, kind, expiresAt };
}

/**
 * The outcome a failed acquire stands for, or null for a failure that is not
 * one (an outage, a bug), which the caller rethrows. A 402 without a payable
 * intent is a broken answer, not a price, and throws.
 */
export function acquireOutcomeOfError(err: unknown): AcquireForInstallResult | null {
  if (!(err instanceof MarketplaceError)) {
    return null;
  }
  switch (err.status) {
    case 402: {
      const intent = purchaseIntentOf(err.body);
      if (intent === null) {
        throw new Error("The marketplace asked for payment without a purchase to pay");
      }
      return { status: "payment_required", intent };
    }
    case 401:
      return err.code === "account_required"
        ? { status: "refused", reason: "account_required", message: "Sign in to your account to get this listing." }
        : null;
    case 403:
      return err.code === "entitlement_revoked"
        ? {
            status: "refused",
            reason: "entitlement_revoked",
            message: "Your access to this listing has ended, so it can't be installed again.",
          }
        : null;
    case 404:
      return { status: "refused", reason: "not_found", message: "This listing is no longer in the marketplace." };
    case 409:
      // The marketplace says why (unpriced, unpublished, replaced by a newer
      // edition), and writes that message for a person.
      return err.code === "listing_unavailable"
        ? { status: "refused", reason: "listing_unavailable", message: err.message }
        : null;
    case 410:
      return {
        status: "refused",
        reason: "downloads_blocked",
        message: "This listing has been pulled from the marketplace and can't be installed.",
      };
    case 429:
      return {
        status: "refused",
        reason: "rate_limited",
        message: "The marketplace is busy right now. Try again in a moment.",
      };
    default:
      return null;
  }
}
