import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { isEntitlementFeatureKey } from "./entitlements";

/**
 * UI feature flags: who sees a UI feature while it rolls out. A flag is a row
 * in `featureFlags`, created and targeted by operators in the backoffice. A
 * flag with no row does not exist and reads as off. A flag is temporary; once
 * its feature is on for everyone its row is deleted. Whether an account's plan
 * includes a feature is an entitlement, not a flag.
 *
 * Code reads a flag by key, so a flag nothing reads does nothing: an operator
 * creates it, then a developer wires it into the UI.
 */

/** How a flag is targeted. Everything but the key is what operators edit. */
export interface FeatureFlagTargeting {
  key: string;
  state: "off" | "on" | "rules";
  rules?: FeatureFlagRules;
}

/** What operators say about a flag when they create it. */
export interface FeatureFlagDefinition {
  description: string;
  /** Who removes the flag once its rollout is done. */
  owner: string;
  /** ISO date by which the flag should be gone. */
  removeBy: string;
}

/**
 * A flag's key as code names it. There is no code-side registry: a key is
 * whatever operators created, and the regex below is what keeps keys tidy.
 */
export type FeatureFlagKey = string;

/** Keys are a lowercase first letter, then dot- or dash-separated words, e.g. `scenes.newToolbar`. */
const FEATURE_FLAG_KEY = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
export const FEATURE_FLAG_KEY_MAX = 64;
export const FEATURE_FLAG_DESCRIPTION_MAX = 200;
export const FEATURE_FLAG_OWNER_MAX = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isFeatureFlagKey(key: string): boolean {
  return key.length <= FEATURE_FLAG_KEY_MAX && FEATURE_FLAG_KEY.test(key);
}

/** Rejects a flag an operator could not have meant, before it is saved. */
export function validateFeatureFlagDefinition(definition: FeatureFlagDefinition): void {
  if (definition.description.trim() === "" || definition.description.length > FEATURE_FLAG_DESCRIPTION_MAX) {
    throw new Error(`description must be 1 to ${FEATURE_FLAG_DESCRIPTION_MAX} characters`);
  }
  if (definition.owner.trim() === "" || definition.owner.length > FEATURE_FLAG_OWNER_MAX) {
    throw new Error(`owner must be 1 to ${FEATURE_FLAG_OWNER_MAX} characters`);
  }
  if (!ISO_DATE.test(definition.removeBy) || !isRealDate(definition.removeBy)) {
    throw new Error(`removeBy must be a date, YYYY-MM-DD, got "${definition.removeBy}"`);
  }
}

/** A date that exists on the calendar: JavaScript rolls 2026-02-31 over, so compare it back. */
function isRealDate(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
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
 * instance always gets it, so an operator can try a feature anywhere.
 * Otherwise every condition that is set must hold, and `percent`, when set,
 * admits a stable share of the audience. `rules` with nothing set is off:
 * an empty rule set is a mistake, not a way to say "everyone", so the
 * backoffice refuses to save one.
 */
export function isFlagOn(row: FeatureFlagTargeting | null, subject: FeatureFlagSubject): boolean {
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
export function validateFeatureFlagRules(rules: Pick<FeatureFlagRules, "percent" | "entitlement">): void {
  if (rules.percent !== undefined && !(Number.isInteger(rules.percent) && rules.percent >= 0 && rules.percent <= 100)) {
    throw new Error(`percent must be an integer from 0 to 100, got ${rules.percent}`);
  }
  if (rules.entitlement !== undefined && !isEntitlementFeatureKey(rules.entitlement)) {
    throw new Error(`Unknown entitlement "${rules.entitlement}"; add it to ENTITLEMENT_FEATURES first`);
  }
}
