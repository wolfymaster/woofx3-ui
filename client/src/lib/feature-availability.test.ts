import { describe, expect, test } from "bun:test";
import type { EngineAvailability } from "@convex/lib/entitlementAccess";
import type { Entitlements } from "@convex/lib/entitlements";
import { billingUiVisible, featureState } from "./feature-availability";

const proEntitlements: Entitlements = {
  plan: { key: "pro", name: "Pro" },
  subscription: null,
  features: ["business"],
  limits: {},
};
const HOSTED: EngineAvailability = { availability: "hosted", entitlements: proEntitlements };
const SELF_HOSTED: EngineAvailability = { availability: "self_hosted" };

describe("featureState", () => {
  const cases: Array<[string, EngineAvailability | null | undefined, ReturnType<typeof featureState>]> = [
    ["loading", undefined, undefined],
    ["not a member", null, "unavailable"],
    ["self-hosted", SELF_HOSTED, "unavailable"],
    ["hosted with the feature", HOSTED, "available"],
  ];
  for (const [name, availability, expected] of cases) {
    test(name, () => {
      expect(featureState(availability, "business")).toBe(expected);
    });
  }

  test("a hosted plan without the feature is an upgrade", () => {
    expect(featureState(HOSTED, "userPages.customDomain")).toBe("upgrade");
  });
});

describe("billingUiVisible", () => {
  test("only for a hosted engine outside the desktop app", () => {
    expect(billingUiVisible(HOSTED, false)).toBe(true);
    expect(billingUiVisible(HOSTED, true)).toBe(false);
    expect(billingUiVisible(SELF_HOSTED, false)).toBe(false);
    expect(billingUiVisible(undefined, false)).toBe(false);
  });
});
