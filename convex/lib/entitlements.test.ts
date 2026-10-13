import { describe, expect, it } from "bun:test";
import { type EntitlementCatalog, type Entitlements, isWithinLimit, PLANS, resolveEntitlements } from "./entitlements";

// The real catalog is empty until plans are priced; these stand in for it.
const catalog = {
  plans: {
    free: { features: [], limits: { "storage.assetBytes": 1_000 } },
    pro: { features: ["reports.advanced"], limits: { "storage.assetBytes": 50_000 } },
    enterprise: { features: ["reports.advanced", "tools.clips"], limits: { "storage.assetBytes": null } },
  },
  features: new Set(["reports.advanced", "tools.clips", "early_access"]),
} as unknown as EntitlementCatalog;

const now = 1_700_000_000_000;

describe("resolveEntitlements", () => {
  it("is the free plan without a license", () => {
    expect(resolveEntitlements(null, now, catalog)).toEqual({
      tier: "free",
      features: [],
      limits: { "storage.assetBytes": 1_000 },
    } as unknown as Entitlements);
  });

  it("adds a license's own features to its tier's", () => {
    const resolved = resolveEntitlements({ tier: "pro", features: ["early_access"] }, now, catalog);
    expect(resolved.tier).toBe("pro");
    expect(resolved.features as readonly string[]).toEqual(["early_access", "reports.advanced"]);
  });

  it("falls back to free once the license expires, dropping its features", () => {
    const expired = resolveEntitlements({ tier: "pro", features: ["early_access"], expiresAt: now }, now, catalog);
    expect(expired.tier).toBe("free");
    expect(expired.features).toEqual([]);
    const current = resolveEntitlements({ tier: "pro", features: [], expiresAt: now + 1 }, now, catalog);
    expect(current.tier).toBe("pro");
  });

  it("ignores license features the catalog no longer lists", () => {
    const resolved = resolveEntitlements({ tier: "free", features: ["retired.feature"] }, now, catalog);
    expect(resolved.features).toEqual([]);
  });

  it("defines every tier in the real catalog", () => {
    expect(Object.keys(PLANS).sort()).toEqual(["enterprise", "free", "pro"]);
  });
});

describe("isWithinLimit", () => {
  const key = "storage.assetBytes" as never;

  it("admits usage up to the limit, and any usage when unlimited", () => {
    const free = resolveEntitlements(null, now, catalog);
    expect(isWithinLimit(free, key, 1_000)).toBe(true);
    expect(isWithinLimit(free, key, 1_001)).toBe(false);
    const enterprise = resolveEntitlements({ tier: "enterprise", features: [] }, now, catalog);
    expect(isWithinLimit(enterprise, key, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("throws for a limit the plan does not set", () => {
    const free = resolveEntitlements(null, now, catalog);
    expect(() => isWithinLimit(free, "seats" as never, 1)).toThrow('does not set limit "seats"');
  });
});
