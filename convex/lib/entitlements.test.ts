import { describe, expect, it } from "bun:test";
import {
  type AccountPlanRow,
  type EntitlementCatalog,
  isWithinLimit,
  type PlanRow,
  resolveEntitlements,
  validateEntitlementInput,
  validatePlanKey,
} from "./entitlements";

// The real catalog is empty until code checks a feature; these stand in for it.
const catalog: EntitlementCatalog = {
  features: {
    "reports.advanced": { description: "Advanced reports" },
    "tools.clips": { description: "Clip tool" },
    "early.access": { description: "Early access" },
  },
  limits: {
    "storage.assetBytes": { description: "Asset storage", unit: "bytes", default: 0 },
    "api.requestsPerDay": { description: "Cloud API requests", unit: "requests per day", default: null },
  },
};

const pro: PlanRow = {
  key: "pro",
  name: "Pro",
  features: ["reports.advanced", "retired.feature"],
  limits: [{ key: "storage.assetBytes", value: 50_000 }],
};

const now = 1_700_000_000_000;

function assignment(overrides: Partial<AccountPlanRow> = {}): AccountPlanRow {
  return { addFeatures: [], removeFeatures: [], limits: [], ...overrides };
}

describe("resolveEntitlements", () => {
  it("is nothing but code defaults when no plan applies", () => {
    expect(resolveEntitlements(null, null, now, catalog)).toEqual({
      plan: null,
      features: [],
      limits: { "storage.assetBytes": 0, "api.requestsPerDay": null },
    });
  });

  it("takes the plan's features and limits, dropping keys code no longer knows", () => {
    const resolved = resolveEntitlements(pro, null, now, catalog);
    expect(resolved.plan).toEqual({ key: "pro", name: "Pro" });
    expect(resolved.features).toEqual(["reports.advanced"]);
    expect(resolved.limits).toEqual({ "storage.assetBytes": 50_000, "api.requestsPerDay": null });
  });

  it("applies the account's overrides over the plan", () => {
    const resolved = resolveEntitlements(
      pro,
      assignment({
        addFeatures: ["tools.clips"],
        removeFeatures: ["reports.advanced"],
        limits: [
          { key: "storage.assetBytes", value: null },
          { key: "api.requestsPerDay", value: 1_000 },
        ],
        expiresAt: now + 1,
      }),
      now,
      catalog
    );
    expect(resolved.features).toEqual(["tools.clips"]);
    expect(resolved.limits).toEqual({ "storage.assetBytes": null, "api.requestsPerDay": 1_000 });
    expect(resolved.expiresAt).toBe(now + 1);
  });

  it("ignores an expired assignment's overrides", () => {
    const resolved = resolveEntitlements(
      pro,
      assignment({ addFeatures: ["tools.clips"], expiresAt: now }),
      now,
      catalog
    );
    expect(resolved.features).toEqual(["reports.advanced"]);
    expect(resolved.expiresAt).toBeUndefined();
  });
});

describe("isWithinLimit", () => {
  const key = "storage.assetBytes" as never;

  it("admits usage up to the limit, and any usage when unlimited", () => {
    const resolved = resolveEntitlements(pro, null, now, catalog);
    expect(isWithinLimit(resolved, key, 50_000)).toBe(true);
    expect(isWithinLimit(resolved, key, 50_001)).toBe(false);
    expect(isWithinLimit(resolved, "api.requestsPerDay" as never, Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("throws for a limit that was not resolved", () => {
    const resolved = resolveEntitlements(pro, null, now, catalog);
    expect(() => isWithinLimit(resolved, "seats" as never, 1)).toThrow('Limit "seats" was not resolved');
  });
});

describe("validateEntitlementInput", () => {
  it("accepts known keys and whole amounts", () => {
    expect(() =>
      validateEntitlementInput(
        { features: ["tools.clips"], limits: [{ key: "storage.assetBytes", value: 10 }] },
        catalog
      )
    ).not.toThrow();
  });

  it("refuses what an operator could not have meant", () => {
    expect(() => validateEntitlementInput({ features: ["nope"], limits: [] }, catalog)).toThrow("Unknown feature");
    expect(() => validateEntitlementInput({ removeFeatures: ["nope"], limits: [] }, catalog)).toThrow(
      "Unknown feature"
    );
    expect(() =>
      validateEntitlementInput({ features: ["tools.clips"], removeFeatures: ["tools.clips"], limits: [] }, catalog)
    ).toThrow("both added and removed");
    expect(() => validateEntitlementInput({ limits: [{ key: "nope", value: 1 }] }, catalog)).toThrow("Unknown limit");
    expect(() =>
      validateEntitlementInput(
        {
          limits: [
            { key: "storage.assetBytes", value: 1 },
            { key: "storage.assetBytes", value: 2 },
          ],
        },
        catalog
      )
    ).toThrow("set twice");
    expect(() => validateEntitlementInput({ limits: [{ key: "storage.assetBytes", value: -1 }] }, catalog)).toThrow(
      "whole number"
    );
    expect(() => validateEntitlementInput({ limits: [{ key: "storage.assetBytes", value: 1.5 }] }, catalog)).toThrow(
      "whole number"
    );
  });
});

describe("validatePlanKey", () => {
  it("accepts lowercase slugs", () => {
    expect(() => validatePlanKey("pro-2026")).not.toThrow();
    expect(() => validatePlanKey("Pro")).toThrow();
    expect(() => validatePlanKey("2026")).toThrow();
    expect(() => validatePlanKey("")).toThrow();
  });
});
