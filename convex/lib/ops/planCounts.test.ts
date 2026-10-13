import { describe, expect, it } from "bun:test";
import { tallyPlanAccounts } from "./planCounts";

const now = 1_800_000_000_000;
const plans = [
  { id: "p-free", key: "free", name: "Free", offered: true, isDefault: true },
  { id: "p-pro", key: "pro", name: "Pro", offered: true, isDefault: false },
  { id: "p-team", key: "team", name: "Team", offered: false, isDefault: false },
];

describe("tallyPlanAccounts", () => {
  it("counts active assignments on their plan and everyone else on the default", () => {
    const result = tallyPlanAccounts(
      plans,
      [
        { planId: "p-pro" },
        { planId: "p-pro", expiresAt: now + 1 },
        // Expired: back on the default plan.
        { planId: "p-team", expiresAt: now - 1 },
        // Overrides only, no plan: on the default plan.
        {},
      ],
      10,
      now
    );
    expect(result.plans.map((plan) => [plan.key, plan.accounts])).toEqual([
      ["free", 8],
      ["pro", 2],
      ["team", 0],
    ]);
    expect(result).toMatchObject({ totalAccounts: 10, withoutPlan: 0, countedAt: now });
  });

  it("with no default plan, unassigned accounts are on none", () => {
    const result = tallyPlanAccounts(
      plans.map((plan) => ({ ...plan, isDefault: false })),
      [{ planId: "p-pro" }],
      4,
      now
    );
    expect(result.withoutPlan).toBe(3);
    expect(result.plans.find((plan) => plan.key === "free")?.accounts).toBe(0);
  });

  it("refuses an assignment to a plan that does not exist", () => {
    expect(() => tallyPlanAccounts(plans, [{ planId: "p-gone" }], 1, now)).toThrow("does not exist");
  });
});
