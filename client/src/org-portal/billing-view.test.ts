import { describe, expect, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import type { OrgEngine, OrgSubscription } from "@convex/organizations";
import { type BillingView, billingView } from "./billing-view";

function engine(hosting: OrgEngine["hosting"]): OrgEngine {
  return { instanceId: "i" as Id<"instances">, name: hosting, hosting, status: null, canOpen: true };
}

function subscription(overrides: Partial<OrgSubscription> = {}): OrgSubscription {
  return {
    plan: "starter",
    interval: null,
    state: "trialing",
    stateReason: null,
    nextBillingAt: 1,
    graceEndsAt: null,
    exemptUntil: null,
    spinDownAt: null,
    hasProviderSubscription: false,
    discount: null,
    ...overrides,
  };
}

const CASES: Array<[string, OrgEngine[], OrgSubscription | null, BillingView["kind"]]> = [
  ["only self-hosted engines need no subscription", [engine("external")], null, "no_subscription_needed"],
  [
    "self-hosted only, even with a leftover subscription",
    [engine("external")],
    subscription(),
    "no_subscription_needed",
  ],
  ["no engines at all", [], null, "no_subscription_needed"],
  ["a hosted engine without a subscription", [engine("managed")], null, "no_plan"],
  ["a trial chooses a plan", [engine("managed"), engine("external")], subscription(), "choose_plan"],
  ["exempt", [engine("managed")], subscription({ state: "exempt" }), "exempt"],
  [
    "a running provider subscription",
    [engine("managed")],
    subscription({ state: "past_due", hasProviderSubscription: true }),
    "provider_managed",
  ],
  [
    "a suspended one reactivates through checkout",
    [engine("managed")],
    subscription({ state: "suspended", hasProviderSubscription: true }),
    "choose_plan",
  ],
];

describe("billingView", () => {
  for (const [name, engines, sub, kind] of CASES) {
    test(name, () => {
      expect(billingView({ engines, subscription: sub }).kind).toBe(kind);
    });
  }
});
