import { describe, expect, test } from "bun:test";
import type { Validator } from "convex/values";
import {
  BILLING_INTERVALS,
  billingIntervalValidator,
  ENGINE_ROLES,
  engineRoleValidator,
  ORG_ROLES,
  orgRoleValidator,
  PLAN_TIERS,
  planTierValidator,
  SUBSCRIPTION_STATES,
  subscriptionStateValidator,
} from "./organization";

function literals(validator: Validator<unknown, "required", string>): unknown[] {
  const json = validator.json as { type: string; value: Array<{ value: unknown }> };
  return json.value.map((member) => member.value);
}

describe("organization enums", () => {
  const cases: Array<[string, readonly string[], Validator<unknown, "required", string>]> = [
    ["org roles", ORG_ROLES, orgRoleValidator],
    ["engine roles", ENGINE_ROLES, engineRoleValidator],
    ["plan tiers", PLAN_TIERS, planTierValidator],
    ["billing intervals", BILLING_INTERVALS, billingIntervalValidator],
    ["subscription states", SUBSCRIPTION_STATES, subscriptionStateValidator],
  ];
  for (const [name, values, validator] of cases) {
    test(`the ${name} validator accepts exactly the listed values`, () => {
      expect(literals(validator)).toEqual([...values]);
    });
  }
});
