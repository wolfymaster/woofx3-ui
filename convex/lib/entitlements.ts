import { v } from "convex/values";
import type { LifecycleReason } from "./billingLifecycle";
import type { BillingInterval, PlanTier, SubscriptionState } from "./organization";

/**
 * Entitlements: what an account's plan includes. A feature is a yes or no
 * ("advanced reports"); a limit is an amount ("asset storage, in bytes").
 * They belong to the organization and apply only to its hosted (managed)
 * engines: a self-hosted engine needs no subscription and never offers a paid
 * feature (lib/entitlementAccess.ts engineAvailability). They are enforced
 * where the thing they gate runs: Convex functions, cloud services, and the
 * resources maintenance provisions. An engine never enforces a plan.
 *
 * Which features and limits exist is code, because a feature means nothing
 * until code checks it. Which plans include them, and which plan each
 * account is on, is data operators edit (`plans`, `accountPlans`).
 */
export interface EntitlementFeatureDefinition {
  description: string;
}

export interface EntitlementLimitDefinition {
  description: string;
  /** What the amount counts: "bytes", "seats", "requests per day". */
  unit: string;
  /**
   * The amount when neither the plan nor the account sets one, so a limit
   * added in code never grants more than intended to plans written before
   * it existed. Null is unlimited.
   */
  default: number | null;
}

/** Every feature a plan, an account override or a flag rule can name. */
export const ENTITLEMENT_FEATURES = {
  // A live page for an engine Convex does not host; managed engines have one
  // on every plan. See lib/userPages.ts userPagesAllowed.
  userPages: {
    description: "A public page for your channel",
  },
  "userPages.customDomain": {
    description: "Your public page on your own domain",
  },
  "marketplace.premiumIncluded": {
    description: "woofx3 premium modules included",
  },
  business: {
    description: "Back-office tools for running the business",
  },
} as const satisfies Record<string, EntitlementFeatureDefinition>;

/** Every limit a plan or an account override can set. */
export const ENTITLEMENT_LIMITS = {
  // Both apply only to a managed engine still on the bucket maintenance
  // provisioned for it; see lib/hostedStorage.ts.
  "storage.hostedAssetBytes": {
    description: "Uploaded asset storage on hosted storage",
    unit: "bytes",
    default: 50 * 1024 * 1024,
  },
  "storage.hostedFileBytes": {
    description: "Largest single upload to hosted storage",
    unit: "bytes",
    default: 10 * 1024 * 1024,
  },
  // Soft: nothing refuses a write over it. Module storage lives on a managed
  // engine's ephemeral disk and its replica in our bucket, so the dashboard
  // warns its owner, and operators see it in the backoffice; see
  // lib/hostedStorage.ts.
  "storage.moduleStorageBytes": {
    description: "Module storage on a managed engine (warned, never enforced)",
    unit: "bytes",
    default: 500 * 1024 * 1024,
  },
  // Counts accountMembers, owner included; checked when inviting to a hosted
  // engine and when an invitee who isn't in the org yet accepts.
  "org.members": {
    description: "People in the organization",
    unit: "seats",
    default: 5,
  },
  "analytics.retentionDays": {
    description: "How long analytics are kept",
    unit: "days",
    default: 30,
  },
} as const satisfies Record<string, EntitlementLimitDefinition>;

export interface AddOnDefinition {
  description: string;
  /** What the add-on grants. */
  features: readonly EntitlementFeatureKey[];
}

/**
 * Paid upgrades: bought one by one on Starter (`subscriptions.addOns`), all
 * included on Pro.
 */
export const ADD_ONS = {} as const satisfies Record<string, AddOnDefinition>;
export type AddOnKey = keyof typeof ADD_ONS;

export type EntitlementFeatureKey = keyof typeof ENTITLEMENT_FEATURES;
export type EntitlementLimitKey = keyof typeof ENTITLEMENT_LIMITS;

/** The features and limits code knows; tests pass their own. */
export interface EntitlementCatalog {
  features: Readonly<Record<string, EntitlementFeatureDefinition>>;
  limits: Readonly<Record<string, EntitlementLimitDefinition>>;
}

export const ENTITLEMENT_CATALOG: EntitlementCatalog = {
  features: ENTITLEMENT_FEATURES,
  limits: ENTITLEMENT_LIMITS,
};

/** Own keys only, so "toString" is never a feature. Object.hasOwn is not in the Convex runtime's lib. */
function hasKey(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.keys(record).includes(key);
}

export function isEntitlementFeatureKey(key: string): key is EntitlementFeatureKey {
  return hasKey(ENTITLEMENT_CATALOG.features, key);
}

/**
 * Limits as stored: a list rather than a record, because limit keys contain
 * dots and Convex field names should not.
 */
export const limitValuesValidator = v.array(v.object({ key: v.string(), value: v.union(v.number(), v.null()) }));

export interface LimitValue {
  key: string;
  /** Null is unlimited. */
  value: number | null;
}

export interface PlanRow {
  key: string;
  name: string;
  features: readonly string[];
  limits: readonly LimitValue[];
}

/** An account's assignment: its plan, if not the default, and changes to it for this account alone. */
export interface AccountPlanRow {
  planId?: unknown;
  addFeatures: readonly string[];
  removeFeatures: readonly string[];
  limits: readonly LimitValue[];
  expiresAt?: number;
}

/** The org's subscription, as entitlements report it; null when it has none. */
export interface SubscriptionSummary {
  plan: PlanTier;
  interval: BillingInterval | null;
  state: SubscriptionState;
  stateReason: LifecycleReason | null;
  nextBillingAt: number | null;
  graceEndsAt: number | null;
  exemptUntil: number | null;
}

/** States in which the subscription's plan applies; `suspended` grants none. */
export const USABLE_SUBSCRIPTION_STATES: readonly SubscriptionState[] = ["trialing", "active", "past_due", "exempt"];

export function isUsable(subscription: SubscriptionSummary): boolean {
  return USABLE_SUBSCRIPTION_STATES.includes(subscription.state);
}

/**
 * The features add-ons grant on a usable subscription: every add-on on Pro,
 * the ones bought on Starter. Unknown add-on keys grant nothing.
 */
export function addOnFeatures(
  subscription: SubscriptionSummary | null,
  addOns: readonly string[],
  registry: Readonly<Record<string, AddOnDefinition>> = ADD_ONS
): string[] {
  if (subscription === null || !isUsable(subscription)) {
    return [];
  }
  const keys = subscription.plan === "pro" ? Object.keys(registry) : addOns.filter((key) => hasKey(registry, key));
  return keys.flatMap((key) => registry[key]?.features ?? []);
}

export interface Entitlements {
  /** The plan the account is on; null when no plan applies, not even a default. */
  plan: { key: string; name: string } | null;
  /** The org's subscription; null when it has none. */
  subscription: SubscriptionSummary | null;
  features: string[];
  /** Every limit code knows, null meaning unlimited. */
  limits: Record<string, number | null>;
  /** When the assignment lapses to the default plan, if it does. */
  expiresAt?: number;
}

export function isAssignmentActive(assignment: AccountPlanRow | null, nowMs: number): assignment is AccountPlanRow {
  return assignment !== null && (assignment.expiresAt === undefined || assignment.expiresAt > nowMs);
}

/** What the subscription adds to a resolution: itself, for reporting, and the features its add-ons grant. */
export interface BillingGrant {
  subscription: SubscriptionSummary | null;
  grantedFeatures: readonly string[];
}

const NO_BILLING: BillingGrant = { subscription: null, grantedFeatures: [] };

/**
 * Resolves what an account may use. `plan` is the plan that applies (the
 * assigned one while the assignment is active, otherwise the default) and
 * `assignment` is ignored once expired, so a lapsed deal falls back to the
 * default plan with none of its overrides. Keys code no longer knows are
 * dropped. A limit is the account's override, else the plan's, else the
 * code default.
 */
export function resolveEntitlements(
  plan: PlanRow | null,
  assignment: AccountPlanRow | null,
  nowMs: number,
  catalog: EntitlementCatalog = ENTITLEMENT_CATALOG,
  billing: BillingGrant = NO_BILLING
): Entitlements {
  const { subscription, grantedFeatures } = billing;
  const active = isAssignmentActive(assignment, nowMs) ? assignment : null;
  const known = (key: string) => hasKey(catalog.features, key);
  const features = new Set([...(plan?.features ?? []), ...grantedFeatures].filter(known));
  for (const feature of active?.addFeatures ?? []) {
    if (known(feature)) {
      features.add(feature);
    }
  }
  for (const feature of active?.removeFeatures ?? []) {
    features.delete(feature);
  }

  const planLimits = new Map((plan?.limits ?? []).map((limit) => [limit.key, limit.value]));
  const accountLimits = new Map((active?.limits ?? []).map((limit) => [limit.key, limit.value]));
  const limits: Record<string, number | null> = {};
  for (const [key, definition] of Object.entries(catalog.limits)) {
    if (accountLimits.has(key)) {
      limits[key] = accountLimits.get(key) ?? null;
    } else if (planLimits.has(key)) {
      limits[key] = planLimits.get(key) ?? null;
    } else {
      limits[key] = definition.default;
    }
  }

  return {
    plan: plan ? { key: plan.key, name: plan.name } : null,
    subscription,
    features: [...features].sort(),
    limits,
    ...(active?.expiresAt !== undefined ? { expiresAt: active.expiresAt } : {}),
  };
}

/** Whether `usage` fits under a limit. Every limit code knows is resolved, so a missing one is a bug. */
export function isWithinLimit(entitlements: Entitlements, key: EntitlementLimitKey, usage: number): boolean {
  const limit = entitlements.limits[key];
  if (limit === undefined) {
    throw new Error(`Limit "${key}" was not resolved`);
  }
  return limit === null || usage <= limit;
}

const PLAN_KEY = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Rejects a plan or an override an operator could not have meant, before it
 * is saved: unknown keys, a feature both added and removed, a limit set
 * twice, or an amount that is not a whole number of at least 0.
 */
export function validateEntitlementInput(
  input: { features?: readonly string[]; removeFeatures?: readonly string[]; limits: readonly LimitValue[] },
  catalog: EntitlementCatalog = ENTITLEMENT_CATALOG
): void {
  for (const feature of [...(input.features ?? []), ...(input.removeFeatures ?? [])]) {
    if (!hasKey(catalog.features, feature)) {
      throw new Error(`Unknown feature "${feature}"; code must list it in ENTITLEMENT_FEATURES first`);
    }
  }
  const removed = new Set(input.removeFeatures ?? []);
  for (const feature of input.features ?? []) {
    if (removed.has(feature)) {
      throw new Error(`"${feature}" is both added and removed`);
    }
  }
  const seen = new Set<string>();
  for (const { key, value } of input.limits) {
    if (!hasKey(catalog.limits, key)) {
      throw new Error(`Unknown limit "${key}"; code must list it in ENTITLEMENT_LIMITS first`);
    }
    if (seen.has(key)) {
      throw new Error(`Limit "${key}" is set twice`);
    }
    seen.add(key);
    if (value !== null && !(Number.isSafeInteger(value) && value >= 0)) {
      throw new Error(`Limit "${key}" must be a whole number of at least 0, or null for unlimited; got ${value}`);
    }
  }
}

export function validatePlanKey(key: string): void {
  if (!PLAN_KEY.test(key)) {
    throw new Error(`Plan key "${key}" must be lowercase letters, digits and dashes, starting with a letter`);
  }
}
