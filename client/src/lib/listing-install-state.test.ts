import { describe, expect, test } from "bun:test";
import type { CatalogListingDetail } from "@convex/lib/marketplaceCatalog";
import { type InstallStateInput, listingInstallState } from "./listing-install-state";

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
    credits: [],
    previews: [],
    ...overrides,
  };
}

function state(overrides: Partial<InstallStateInput> = {}) {
  return listingInstallState({
    listing: listing(),
    owned: false,
    entitlementsLoading: false,
    entitlementsError: null,
    installedVersion: undefined,
    baseModuleInstalled: true,
    bundleInstalled: false,
    ...overrides,
  });
}

const paid = { price: { amountCents: 499, currency: "usd" } };

describe("listingInstallState", () => {
  test("a free listing is installable, as it always has been", () => {
    expect(state()).toEqual({ kind: "installable" });
  });

  test("a paid listing is purchasable until the account owns it", () => {
    expect(state({ listing: listing(paid) })).toEqual({ kind: "purchasable" });
    expect(state({ listing: listing(paid), owned: true })).toEqual({ kind: "installable" });
  });

  test("an installed listing offers nothing, and an outdated one offers an update", () => {
    expect(state({ installedVersion: "1.2.0" })).toEqual({ kind: "installed" });
    expect(state({ installedVersion: "1.0.0" })).toEqual({ kind: "updatable" });
    // An installed version newer than the catalog's is not an update.
    expect(state({ installedVersion: "2.0.0" })).toEqual({ kind: "installed" });
  });

  test("being installed outranks ownership, so a bought listing is not sold twice", () => {
    expect(state({ listing: listing(paid), owned: true, installedVersion: "1.2.0" })).toEqual({ kind: "installed" });
    // Even unowned: whatever the entitlement says, it is already on the engine.
    expect(state({ listing: listing(paid), owned: false, installedVersion: "1.2.0" })).toEqual({ kind: "installed" });
  });

  test("a theme with no base module outranks everything, including being paid for", () => {
    const theme = listing({ type: "theme", baseModuleId: "counter", ...paid });
    // Installing it would fail at the engine, which enforces `requires`.
    expect(state({ listing: theme, baseModuleInstalled: false, owned: true })).toEqual({
      kind: "needs_base_module",
      baseModuleId: "counter",
    });
    expect(state({ listing: theme, baseModuleInstalled: true, owned: true })).toEqual({ kind: "installable" });
  });

  test("a theme that needs nothing is unaffected by the base module check", () => {
    const theme = listing({ type: "theme" });
    expect(state({ listing: theme, baseModuleInstalled: false })).toEqual({ kind: "installable" });
  });

  test("unreadable entitlements fall back to Buy, never to Install", () => {
    // The server refuses an install it cannot verify either, so Install here
    // would produce a failure the streamer cannot act on.
    expect(state({ listing: listing(paid), entitlementsError: "marketplace unreachable" })).toEqual({
      kind: "unknown",
    });
    // A free listing is unaffected: there is nothing to verify.
    expect(state({ entitlementsError: "marketplace unreachable" })).toEqual({ kind: "installable" });
  });

  test("while entitlements load, a paid listing shows Buy rather than flickering", () => {
    expect(state({ listing: listing(paid), entitlementsLoading: true })).toEqual({ kind: "purchasable" });
  });

  test("a freshly installed bundle reads as installed", () => {
    const overlay = listing({ type: "overlay" });
    expect(state({ listing: overlay })).toEqual({ kind: "installable" });
    // A bundle has no moduleRepository row to detect it by, so the session's
    // own success is what the button goes on.
    expect(state({ listing: overlay, bundleInstalled: true })).toEqual({ kind: "installed" });
  });
});
