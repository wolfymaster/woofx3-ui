import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { isEntitlementFeatureKey } from "./entitlements";

/**
 * UI feature flags: who sees a UI feature while it rolls out. A flag is
 * temporary; once its feature is on for everyone the flag and its row are
 * deleted. Whether an account's plan includes a feature is an entitlement,
 * not a flag.
 */
export interface FeatureFlagDefinition {
  description: string;
  /** Who removes the flag once its rollout is done. */
  owner: string;
  /** ISO date by which the flag should be gone. */
  removeBy: string;
}

/**
 * Every flag the UI knows. A key must be listed here before a row can be
 * written for it, so a flag cannot be turned on by a typo, and a row whose
 * key is gone from this list is ignored.
 */
export const FEATURE_FLAGS = {
  "marketplace.engineInstall": {
    description:
      "Marketplace installs, install reviews and setup platform reviews run on the engine (installMarketplaceListing and friends) with a buyer token, instead of Convex downloading the archive. Only for engines reporting modules.marketplaceInstall and instances without dev marketplace access; roll out to managed engines first.",
    owner: "wolfy",
    removeBy: "2027-03-31",
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

const FEATURE_FLAG_KEYS: ReadonlySet<string> = new Set(Object.keys(FEATURE_FLAGS));

export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return FEATURE_FLAG_KEYS.has(key);
}

export const featureFlagRulesValidator = v.object({
  users: v.optional(v.array(v.id("users"))),
  accounts: v.optional(v.array(v.id("accounts"))),
  instances: v.optional(v.array(v.id("instances"))),
  percent: v.optional(v.number()),
  hosting: v.optional(v.union(v.literal("managed"), v.literal("external"))),
  entitlement: v.optional(v.string()),
});

export const featureFlagStateValidator = v.union(v.literal("off"), v.literal("on"), v.literal("rules"));

export interface FeatureFlagRules {
  users?: Id<"users">[];
  accounts?: Id<"accounts">[];
  instances?: Id<"instances">[];
  /** Share of the audience, 0 to 100, bucketed by account (by user when there is no account). */
  percent?: number;
  hosting?: "managed" | "external";
  /** An entitlement feature the account's plan must include. */
  entitlement?: string;
}

export interface FeatureFlagRow {
  key: string;
  state: "off" | "on" | "rules";
  rules?: FeatureFlagRules;
}

/** Who a flag is evaluated for. Any part may be unknown, e.g. before an instance is chosen. */
export interface FeatureFlagSubject {
  userId?: Id<"users">;
  accountId?: Id<"accounts">;
  instanceId?: Id<"instances">;
  hosting?: "managed" | "external";
  /** The account's entitlement features; empty without an account. */
  entitlements: readonly string[];
}

/**
 * Whether a flag is on for a subject. An allowlisted user, account or
 * instance always gets it, so an operator can try a feature on any instance.
 * Otherwise every condition that is set must hold, and `percent`, when set,
 * admits a stable share of the audience. `rules` with nothing set is off:
 * an empty rule set is a mistake, not a way to say "everyone".
 */
export function isFlagOn(row: FeatureFlagRow | null, subject: FeatureFlagSubject): boolean {
  if (row === null || row.state === "off") {
    return false;
  }
  if (row.state === "on") {
    return true;
  }
  const rules = row.rules ?? {};
  if (isAllowlisted(rules, subject)) {
    return true;
  }
  const hasCondition = rules.hosting !== undefined || rules.entitlement !== undefined || rules.percent !== undefined;
  if (!hasCondition) {
    return false;
  }
  if (rules.hosting !== undefined && subject.hosting !== rules.hosting) {
    return false;
  }
  if (rules.entitlement !== undefined && !subject.entitlements.includes(rules.entitlement)) {
    return false;
  }
  if (rules.percent !== undefined) {
    const audience = subject.accountId ?? subject.userId;
    if (audience === undefined) {
      return false;
    }
    return rolloutBucket(row.key, audience) < rules.percent;
  }
  return true;
}

function isAllowlisted(rules: FeatureFlagRules, subject: FeatureFlagSubject): boolean {
  return (
    (subject.userId !== undefined && (rules.users ?? []).includes(subject.userId)) ||
    (subject.accountId !== undefined && (rules.accounts ?? []).includes(subject.accountId)) ||
    (subject.instanceId !== undefined && (rules.instances ?? []).includes(subject.instanceId))
  );
}

/**
 * A stable bucket in [0, 100) for an audience id. The flag key is part of the
 * hash so each flag's first 10% is a different set of accounts.
 */
export function rolloutBucket(flagKey: string, audienceId: string): number {
  // FNV-1a, 32-bit: stable across deployments and runtimes, unlike Math.random or a seeded PRNG.
  let hash = 0x811c9dc5;
  for (const char of `${flagKey}:${audienceId}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/** Rejects rules an operator could not have meant, before they are saved. */
export function validateFeatureFlagRules(rules: FeatureFlagRules): void {
  if (rules.percent !== undefined && !(Number.isInteger(rules.percent) && rules.percent >= 0 && rules.percent <= 100)) {
    throw new Error(`percent must be an integer from 0 to 100, got ${rules.percent}`);
  }
  if (rules.entitlement !== undefined && !isEntitlementFeatureKey(rules.entitlement)) {
    throw new Error(`Unknown entitlement "${rules.entitlement}"; add it to ENTITLEMENT_FEATURES first`);
  }
}
