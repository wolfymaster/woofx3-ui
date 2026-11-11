import { describe, expect, test } from "bun:test";
import { MarketplaceError } from "./marketplaceApi";
import { type AcquireForInstallResult, acquireOutcomeOfError, licensedFromAcquire } from "./marketplaceLicense";

const LICENSE = { key: "W3X-AAAA-BBBB-CCCC", listingId: "cozy-alerts", edition: 1 };
const INTENT = {
  id: "pi_123",
  amountCents: 900,
  currency: "usd",
  kind: "full",
  expiresAt: "2026-11-11T12:00:00Z",
};

function refusal(status: number, code: string, message = "the marketplace says no", body: unknown = null) {
  return new MarketplaceError(status, code, message, body);
}

describe("licensedFromAcquire", () => {
  const NO_LICENSE = { throws: "The marketplace answered acquire without a license" };
  const NO_EDITION = { throws: "The marketplace answered acquire with a license for no edition" };
  const cases: { name: string; payload: unknown; expected: AcquireForInstallResult | { throws: string } }[] = [
    {
      name: "a claim or a holding answers with its license",
      payload: { entitled: true, source: "free", license: LICENSE },
      expected: { status: "licensed", license: LICENSE },
    },
    {
      name: "an answer without a license is a marketplace that cannot serve this flow",
      payload: { entitled: true, source: "free" },
      expected: NO_LICENSE,
    },
    {
      name: "an empty key is no key",
      payload: { entitled: true, license: { ...LICENSE, key: " " } },
      expected: NO_LICENSE,
    },
    { name: "not entitled is not a license", payload: { entitled: false, license: LICENSE }, expected: NO_LICENSE },
    {
      name: "a license for no edition is broken",
      payload: { entitled: true, license: { ...LICENSE, edition: 0 } },
      expected: NO_EDITION,
    },
  ];
  for (const { name, payload, expected } of cases) {
    test(name, () => {
      if (expected !== null && "throws" in expected) {
        expect(() => licensedFromAcquire(payload)).toThrow(expected.throws);
        return;
      }
      expect(licensedFromAcquire(payload)).toEqual(expected);
    });
  }
});

describe("acquireOutcomeOfError", () => {
  const cases: { name: string; err: unknown; expected: AcquireForInstallResult | null | { throws: string } }[] = [
    {
      name: "402 is the purchase to pay",
      err: refusal(402, "payment_required", "pay", { error: { code: "payment_required" }, intent: INTENT }),
      expected: { status: "payment_required", intent: { ...INTENT, kind: "full" } },
    },
    {
      name: "402 for an upgrade keeps its kind",
      err: refusal(402, "payment_required", "pay", { intent: { ...INTENT, kind: "upgrade", amountCents: 300 } }),
      expected: { status: "payment_required", intent: { ...INTENT, kind: "upgrade", amountCents: 300 } },
    },
    {
      name: "402 without a payable intent is a broken answer",
      err: refusal(402, "payment_required", "pay", { intent: { ...INTENT, amountCents: 0 } }),
      expected: { throws: "The marketplace asked for payment without a purchase to pay" },
    },
    {
      name: "401 account_required asks the streamer to sign in",
      err: refusal(401, "account_required"),
      expected: {
        status: "refused",
        reason: "account_required",
        message: "Sign in to your account to get this listing.",
      },
    },
    {
      name: "403 entitlement_revoked says access has ended",
      err: refusal(403, "entitlement_revoked"),
      expected: {
        status: "refused",
        reason: "entitlement_revoked",
        message: "Your access to this listing has ended, so it can't be installed again.",
      },
    },
    {
      name: "404 is a listing that is gone",
      err: refusal(404, "listing_not_found"),
      expected: { status: "refused", reason: "not_found", message: "This listing is no longer in the marketplace." },
    },
    {
      name: "409 listing_unavailable passes the marketplace's own sentence on",
      err: refusal(409, "listing_unavailable", "this listing has no pricing yet, so nobody can install it"),
      expected: {
        status: "refused",
        reason: "listing_unavailable",
        message: "this listing has no pricing yet, so nobody can install it",
      },
    },
    {
      name: "410 is a listing pulled from every engine",
      err: refusal(410, "downloads_blocked"),
      expected: {
        status: "refused",
        reason: "downloads_blocked",
        message: "This listing has been pulled from the marketplace and can't be installed.",
      },
    },
    {
      name: "429 asks to try again",
      err: refusal(429, "rate_limited"),
      expected: {
        status: "refused",
        reason: "rate_limited",
        message: "The marketplace is busy right now. Try again in a moment.",
      },
    },
    { name: "401 for any other reason is a failure", err: refusal(401, "unauthorized"), expected: null },
    { name: "403 for any other reason is a failure", err: refusal(403, "forbidden"), expected: null },
    { name: "another 409 is a failure", err: refusal(409, "edition_conflict"), expected: null },
    { name: "an outage is a failure", err: refusal(503, "unavailable"), expected: null },
    { name: "a network error is a failure", err: new Error("socket hang up"), expected: null },
  ];
  for (const { name, err, expected } of cases) {
    test(name, () => {
      if (expected !== null && "throws" in expected) {
        expect(() => acquireOutcomeOfError(err)).toThrow(expected.throws);
        return;
      }
      expect(acquireOutcomeOfError(err)).toEqual(expected);
    });
  }
});
