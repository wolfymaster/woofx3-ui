import { describe, expect, test } from "bun:test";
import { validateEntitlementInput, validatePlanKey } from "../lib/entitlements";
import { PLAN_SEEDS } from "./plans";

// A copy of the hosted plans in the marketing site's pricing table
// (woofx3-marketing client/src/content/pricing.ts). Must match it: the seeds
// are what the page promises.
const PRICING_PAGE = {
  starter: {
    users: 5,
    moduleStorageGb: 50,
    assetStorageGb: 100,
    analyticsDays: 30,
    customDomain: false,
    premiumModulesIncluded: false,
    businessTools: false,
  },
  pro: {
    users: null,
    moduleStorageGb: 100,
    assetStorageGb: 500,
    analyticsDays: 90,
    customDomain: true,
    premiumModulesIncluded: true,
    businessTools: true,
  },
} as const;

const GiB = 1024 * 1024 * 1024;

describe("plan seeds", () => {
  for (const seed of PLAN_SEEDS) {
    test(`${seed.key} matches the pricing page`, () => {
      const page = PRICING_PAGE[seed.key];
      const limit = (key: string) => seed.limits.find((l) => l.key === key)?.value;
      expect(limit("org.members")).toBe(page.users);
      expect(limit("storage.moduleStorageBytes")).toBe(page.moduleStorageGb * GiB);
      expect(limit("storage.hostedAssetBytes")).toBe(page.assetStorageGb * GiB);
      expect(limit("analytics.retentionDays")).toBe(page.analyticsDays);
      expect(seed.features.includes("userPages.customDomain")).toBe(page.customDomain);
      expect(seed.features.includes("marketplace.premiumIncluded")).toBe(page.premiumModulesIncluded);
      expect(seed.features.includes("business")).toBe(page.businessTools);
    });

    test(`${seed.key} is a valid plan`, () => {
      expect(() => validatePlanKey(seed.key)).not.toThrow();
      expect(() => validateEntitlementInput({ features: seed.features, limits: seed.limits })).not.toThrow();
    });
  }

  test("there is a seed for every tier", () => {
    expect(PLAN_SEEDS.map((seed) => seed.key).sort()).toEqual(["pro", "starter"]);
  });
});
