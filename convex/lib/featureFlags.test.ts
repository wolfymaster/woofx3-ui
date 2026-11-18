import { describe, expect, it } from "bun:test";
import type { Id } from "../_generated/dataModel";
import {
  type FeatureFlagSubject,
  type FeatureFlagTargeting,
  isFeatureFlagKey,
  isFlagOn,
  rolloutBucket,
  validateFeatureFlagDefinition,
  validateFeatureFlagRules,
} from "./featureFlags";

const user = "user1" as Id<"users">;
const account = "account1" as Id<"accounts">;
const instance = "instance1" as Id<"instances">;

const subject: FeatureFlagSubject = {
  userId: user,
  accountId: account,
  instanceId: instance,
  hosting: "external",
  entitlements: [],
};

function rules(r: FeatureFlagTargeting["rules"]): FeatureFlagTargeting {
  return { key: "demo", state: "rules", rules: r };
}

describe("isFlagOn", () => {
  it("is off without a row and follows a fixed state", () => {
    expect(isFlagOn(null, subject)).toBe(false);
    expect(isFlagOn({ key: "demo", state: "off" }, subject)).toBe(false);
    expect(isFlagOn({ key: "demo", state: "on" }, subject)).toBe(true);
  });

  it("treats rules with nothing set as off", () => {
    expect(isFlagOn(rules({}), subject)).toBe(false);
    expect(isFlagOn({ key: "demo", state: "rules" }, subject)).toBe(false);
  });

  it("lets an allowlisted user, account or instance in past every condition", () => {
    const managedOnly = { hosting: "managed" as const, entitlement: "early_access", percent: 0 };
    expect(isFlagOn(rules({ ...managedOnly, users: [user] }), subject)).toBe(true);
    expect(isFlagOn(rules({ ...managedOnly, accounts: [account] }), subject)).toBe(true);
    expect(isFlagOn(rules({ ...managedOnly, instances: [instance] }), subject)).toBe(true);
    expect(isFlagOn(rules({ users: ["other" as Id<"users">] }), subject)).toBe(false);
  });

  it("requires every condition that is set", () => {
    expect(isFlagOn(rules({ hosting: "external" }), subject)).toBe(true);
    expect(isFlagOn(rules({ hosting: "managed" }), subject)).toBe(false);
    expect(isFlagOn(rules({ entitlement: "early_access" }), subject)).toBe(false);
    expect(isFlagOn(rules({ entitlement: "early_access" }), { ...subject, entitlements: ["early_access"] })).toBe(true);
    expect(
      isFlagOn(rules({ hosting: "external", entitlement: "early_access" }), {
        ...subject,
        entitlements: ["early_access"],
        hosting: "managed",
      })
    ).toBe(false);
  });

  it("admits a stable share of accounts by percent", () => {
    expect(isFlagOn(rules({ percent: 100 }), subject)).toBe(true);
    expect(isFlagOn(rules({ percent: 0 }), subject)).toBe(false);
    const bucket = rolloutBucket("demo", account);
    expect(isFlagOn(rules({ percent: bucket + 1 }), subject)).toBe(true);
    expect(isFlagOn(rules({ percent: bucket }), subject)).toBe(false);
  });

  it("buckets by user when there is no account, and refuses a subject with neither", () => {
    const signedInOnly: FeatureFlagSubject = { userId: user, entitlements: [] };
    const bucket = rolloutBucket("demo", user);
    expect(isFlagOn(rules({ percent: bucket + 1 }), signedInOnly)).toBe(true);
    expect(isFlagOn(rules({ percent: 100 }), { entitlements: [] })).toBe(false);
  });
});

describe("rolloutBucket", () => {
  it("is stable, in range, and differs by flag", () => {
    expect(rolloutBucket("a", "account1")).toBe(rolloutBucket("a", "account1"));
    const buckets = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const bucket = rolloutBucket("demo", `account${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
      buckets.add(bucket);
    }
    expect(buckets.size).toBe(100);
    const flagsDiffer = Array.from({ length: 50 }, (_, i) => `account${i}`).some(
      (id) => rolloutBucket("one", id) !== rolloutBucket("two", id)
    );
    expect(flagsDiffer).toBe(true);
  });
});

describe("validateFeatureFlagRules", () => {
  it("accepts integer percents from 0 to 100 and rejects the rest", () => {
    expect(() => validateFeatureFlagRules({ percent: 0 })).not.toThrow();
    expect(() => validateFeatureFlagRules({ percent: 100 })).not.toThrow();
    expect(() => validateFeatureFlagRules({ percent: 101 })).toThrow();
    expect(() => validateFeatureFlagRules({ percent: -1 })).toThrow();
    expect(() => validateFeatureFlagRules({ percent: 12.5 })).toThrow();
  });

  it("rejects a blank license feature", () => {
    expect(() => validateFeatureFlagRules({ entitlement: " " })).toThrow();
    expect(() => validateFeatureFlagRules({ entitlement: "no.such.feature" })).toThrow();
  });
});

describe("isFeatureFlagKey", () => {
  it("accepts the keys code and operators write", () => {
    for (const key of ["scenes.newToolbar", "early-access", "chat.pins", "a"]) {
      expect(isFeatureFlagKey(key)).toBe(true);
    }
  });

  it("refuses a key a typo would produce", () => {
    for (const key of ["", "Scenes.toolbar", ".leading", "trailing.", "two..dots", "with space", "x".repeat(65)]) {
      expect(isFeatureFlagKey(key)).toBe(false);
    }
  });
});

describe("validateFeatureFlagDefinition", () => {
  const valid = { description: "The new scene toolbar", owner: "ops@woofx3.tv", removeBy: "2026-12-31" };

  it("accepts a complete definition", () => {
    expect(() => validateFeatureFlagDefinition(valid)).not.toThrow();
  });

  it("rejects text an operator could not have meant", () => {
    expect(() => validateFeatureFlagDefinition({ ...valid, description: "   " })).toThrow();
    expect(() => validateFeatureFlagDefinition({ ...valid, description: "x".repeat(201) })).toThrow();
    expect(() => validateFeatureFlagDefinition({ ...valid, owner: "" })).toThrow();
    expect(() => validateFeatureFlagDefinition({ ...valid, removeBy: "soon" })).toThrow();
    expect(() => validateFeatureFlagDefinition({ ...valid, removeBy: "2026-02-31" })).toThrow();
  });
});
