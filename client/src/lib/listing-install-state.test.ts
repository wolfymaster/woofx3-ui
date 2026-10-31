import { describe, expect, test } from "bun:test";
import { installedVersionsByListing, laterEditionInstalled } from "@convex/lib/marketplaceInstallIdentity";
import type { CatalogListingDetail, ListingPricing, ListingQuote } from "@shared/marketplace-catalog";
import { type InstallStateInput, listingInstallState } from "./listing-install-state";

const FREE: ListingPricing = { mode: "free" };
const PAID: ListingPricing = { mode: "paid", amountCents: 499, currency: "usd", upgrade: { mode: "full" } };

function listing(overrides: Partial<CatalogListingDetail> = {}): CatalogListingDetail {
  return {
    id: "counter",
    type: "module",
    name: "Counter",
    description: "",
    version: "1.2.0",
    author: "wolfy",
    category: "Utilities",
    tags: [],
    images: {},
    tier: "public",
    pricing: FREE,
    edition: 1,
    credits: [],
    previews: [],
    installCount: 0,
    weeklyInstallCount: 0,
    ratingCount: 0,
    ...overrides,
  };
}

function state(overrides: Partial<InstallStateInput> = {}) {
  return listingInstallState({
    listing: listing(),
    purchases: true,
    quote: null,
    quoteLoading: false,
    quoteError: null,
    installedVersion: undefined,
    baseModuleInstalled: true,
    bundleInstalled: false,
    ...overrides,
  });
}

const full: ListingQuote = { kind: "full", amountCents: 499, currency: "usd" };

describe("listingInstallState", () => {
  test("an emote pack never offers Install, owned, free or otherwise", () => {
    // There is no engine call for an emote pack; Install would send its id
    // down the module install path.
    for (const overrides of [
      {},
      { quote: { kind: "owned" } as const },
      { quoteError: "down" },
      { installedVersion: "1.0.0" },
    ]) {
      expect(state({ listing: listing({ type: "emote" }), ...overrides })).toEqual({ kind: "not_installable" });
    }
  });

  test("a free listing installs without waiting for a quote", () => {
    expect(state({ quoteLoading: true })).toEqual({ kind: "installable" });
    expect(state({ quoteError: "marketplace unreachable" })).toEqual({ kind: "installable" });
  });

  test("a paid listing is purchasable at the quoted price until the account owns it", () => {
    expect(state({ listing: listing({ pricing: PAID }), quote: full })).toEqual({
      kind: "purchasable",
      amountCents: 499,
      currency: "usd",
    });
    expect(state({ listing: listing({ pricing: PAID }), quote: { kind: "owned" } })).toEqual({
      kind: "installable",
      owned: true,
    });
  });

  test("an earlier edition's holder is offered the upgrade the quote names", () => {
    const v2 = listing({ id: "counter-v2", edition: 2, moduleKey: "counter", pricing: PAID });
    expect(
      state({ listing: v2, quote: { kind: "upgrade", amountCents: 199, currency: "usd", upgradeFrom: "counter" } })
    ).toEqual({ kind: "purchasable", amountCents: 199, currency: "usd", upgradeFrom: "counter" });
    expect(state({ listing: v2, quote: { kind: "upgrade_free", upgradeFrom: "counter" } })).toEqual({
      kind: "installable",
      upgradeFrom: "counter",
    });
  });

  test("edition 1 installed makes edition 2 an upgrade, not an update, though both share a manifest id", () => {
    // Installed before provenance existed: the key is all there is.
    const rows = [{ moduleKey: "counter:1.2.0:abcdef0" }];
    const v2 = listing({ id: "counter-v2", edition: 2, moduleKey: "counter", version: "2.0.0", pricing: PAID });
    const installed = {
      installedVersion: installedVersionsByListing(rows).get(v2.id),
      laterEditionInstalled: laterEditionInstalled(rows, v2),
    };
    expect(installed).toEqual({ installedVersion: undefined, laterEditionInstalled: false });
    expect(
      state({
        listing: v2,
        ...installed,
        quote: { kind: "upgrade", amountCents: 199, currency: "usd", upgradeFrom: "counter" },
      })
    ).toEqual({ kind: "purchasable", amountCents: 199, currency: "usd", upgradeFrom: "counter" });
    // Edition 1's own page still reads it as installed.
    expect(installedVersionsByListing(rows).get("counter")).toBe("1.2.0");
  });

  test("edition 2 installed reads as installed on both editions' pages, so edition 1 is never offered over it", () => {
    const rows = [{ moduleKey: "counter:2.0.0:abcdef0", marketplaceListingId: "counter-v2", marketplaceEdition: 2 }];
    const v1 = listing({ moduleKey: "counter", pricing: PAID, supersededBy: "counter-v2" });
    const v2 = listing({ id: "counter-v2", edition: 2, moduleKey: "counter", version: "2.0.0", pricing: PAID });
    const quote: ListingQuote = { kind: "owned" };

    expect(
      state({
        listing: v1,
        quote,
        installedVersion: installedVersionsByListing(rows).get(v1.id),
        laterEditionInstalled: laterEditionInstalled(rows, v1),
      })
    ).toEqual({ kind: "installed" });
    expect(
      state({
        listing: v2,
        quote,
        installedVersion: installedVersionsByListing(rows).get(v2.id),
        laterEditionInstalled: laterEditionInstalled(rows, v2),
      })
    ).toEqual({ kind: "installed" });
  });

  test("a listing nobody can acquire says why", () => {
    expect(state({ listing: listing({ pricing: null }), quote: { kind: "unavailable", reason: "unpriced" } })).toEqual({
      kind: "unavailable",
      reason: "unpriced",
      supersededBy: undefined,
    });
    // A free edition that a newer one replaced is not offered to new buyers.
    const old = listing({ supersededBy: "counter-v2" });
    expect(state({ listing: old, quote: { kind: "unavailable", reason: "superseded" } })).toEqual({
      kind: "unavailable",
      reason: "superseded",
      supersededBy: "counter-v2",
    });
  });

  test("an installed listing offers nothing, and an outdated one offers an update", () => {
    expect(state({ installedVersion: "1.2.0" })).toEqual({ kind: "installed" });
    expect(state({ installedVersion: "1.0.0" })).toEqual({ kind: "updatable" });
    // An installed version newer than the catalog's is not an update.
    expect(state({ installedVersion: "2.0.0" })).toEqual({ kind: "installed" });
  });

  test("being installed outranks the quote, so a listing is not sold twice", () => {
    expect(state({ listing: listing({ pricing: PAID }), quote: full, installedVersion: "1.2.0" })).toEqual({
      kind: "installed",
    });
  });

  test("a theme with no base module outranks everything, including being paid for", () => {
    const theme = listing({ type: "theme", baseModuleId: "counter", pricing: PAID });
    // Installing it would fail at the engine, which enforces `requires`.
    expect(state({ listing: theme, baseModuleInstalled: false, quote: { kind: "owned" } })).toEqual({
      kind: "needs_base_module",
      baseModuleId: "counter",
    });
    expect(state({ listing: theme, baseModuleInstalled: true, quote: { kind: "owned" } })).toEqual({
      kind: "installable",
      owned: true,
    });
  });

  test("an unreadable quote is unknown, never Install", () => {
    // The server refuses an install it cannot verify either, so Install here
    // would produce a failure the streamer cannot act on.
    expect(state({ listing: listing({ pricing: PAID }), quoteError: "marketplace unreachable" })).toEqual({
      kind: "unknown",
    });
  });

  test("while the quote loads, a paid listing waits rather than guessing a price", () => {
    expect(state({ listing: listing({ pricing: PAID }), quoteLoading: true })).toEqual({ kind: "checking" });
  });

  test("with no purchases, a paid listing asks for a sign-in and no quote is waited for", () => {
    const local = { purchases: false, quote: null, quoteLoading: false };
    expect(state({ ...local, listing: listing({ pricing: PAID }) })).toEqual({ kind: "sign_in_to_buy" });
    expect(state({ ...local, listing: listing({ pricing: FREE }) })).toEqual({ kind: "installable" });
    expect(state({ ...local, listing: listing({ pricing: null }) })).toEqual({
      kind: "unavailable",
      reason: "unpriced",
    });
    expect(state({ ...local, listing: listing({ pricing: FREE, supersededBy: "counter-v2" }) })).toEqual({
      kind: "unavailable",
      reason: "superseded",
      supersededBy: "counter-v2",
    });
    expect(state({ ...local, listing: listing({ pricing: PAID }), installedVersion: "1.2.0" })).toEqual({
      kind: "installed",
    });
  });

  test("a freshly installed bundle reads as installed", () => {
    const overlay = listing({ type: "overlay" });
    expect(state({ listing: overlay })).toEqual({ kind: "installable" });
    // A bundle has no moduleRepository row to detect it by, so the session's
    // own success is what the button goes on.
    expect(state({ listing: overlay, bundleInstalled: true })).toEqual({ kind: "installed" });
  });
});
