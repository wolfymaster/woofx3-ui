import { describe, expect, test } from "bun:test";
import { MarketplaceError } from "./marketplaceApi";
import { acquireRefusal, contentRefusal, publicListingIsFree } from "./marketplaceEntitlement";

describe("acquireRefusal", () => {
  test("a listing that costs money has not been bought", () => {
    const err = new MarketplaceError(402, "payment_required", "this listing costs 900 usd for this buyer");
    expect(acquireRefusal(err, "Cozy Alerts")).toBe("Cozy Alerts hasn't been bought on this account.");
  });

  test("an unavailable listing says why, in the marketplace's words", () => {
    const err = new MarketplaceError(
      409,
      "listing_unavailable",
      "this listing has no pricing yet, so nobody can install it"
    );
    expect(acquireRefusal(err, "Cozy Alerts")).toBe("this listing has no pricing yet, so nobody can install it");
  });

  test("a missing listing is gone from the marketplace", () => {
    expect(acquireRefusal(new MarketplaceError(404, "listing_not_found", "listing not found"), "Cozy Alerts")).toBe(
      "Cozy Alerts is no longer in the marketplace."
    );
  });

  test("anything else is a failure, not a refusal", () => {
    for (const err of [
      new MarketplaceError(500, "internal_error", "boom"),
      new MarketplaceError(409, "something_else", "?"),
      new Error("network"),
      "nope",
    ]) {
      expect(acquireRefusal(err, "Cozy Alerts")).toBeNull();
    }
  });
});

describe("publicListingIsFree", () => {
  test("only an explicit free pricing is free", () => {
    expect(publicListingIsFree({ listing: { id: "counter", pricing: { mode: "free", currency: "usd" } } })).toBe(true);
  });

  test("unpriced, paid, or unrecognised pricing is not free", () => {
    for (const pricing of [
      null,
      undefined,
      { mode: "paid", amountCents: 500, currency: "usd" },
      { mode: "FREE" },
      "free",
      0,
    ]) {
      expect(publicListingIsFree({ listing: { id: "counter", pricing } })).toBe(false);
    }
  });

  test("a listing that cannot be read is not free", () => {
    expect(publicListingIsFree(null)).toBe(false);
    expect(publicListingIsFree({})).toBe(false);
    expect(publicListingIsFree({ listing: "counter" })).toBe(false);
  });
});

describe("contentRefusal", () => {
  test("content the account does not hold has not been bought", () => {
    const err = new MarketplaceError(403, "not_entitled", "this account does not hold this listing");
    expect(contentRefusal(err, "Cozy Alerts")).toBe("Cozy Alerts hasn't been bought on this account.");
  });

  test("content refused for want of a token says so", () => {
    expect(contentRefusal(new MarketplaceError(401, "unauthorized", "x"), "Cozy Alerts")).toContain(
      "MARKETPLACE_API_TOKEN"
    );
  });

  test("anything else is a failure, not a refusal", () => {
    expect(contentRefusal(new MarketplaceError(404, "module_not_found", "x"), "Cozy Alerts")).toBeNull();
    expect(contentRefusal(new Error("network"), "Cozy Alerts")).toBeNull();
  });
});
