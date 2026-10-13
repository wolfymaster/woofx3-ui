/**
 * Entitlements: what an account's plan includes. A feature is a yes or no
 * ("advanced reports"); a limit is an amount ("asset storage, in bytes").
 * They belong to the account, whatever hosts its engines, and are enforced
 * where the thing they gate runs: Convex functions, cloud services, and the
 * resources maintenance provisions. An engine never enforces a plan; a
 * self-hosted engine has every capability its build has.
 */
export interface EntitlementDefinition {
  description: string;
}

export interface EntitlementLimitDefinition extends EntitlementDefinition {
  /** What the amount counts: "bytes", "seats", "instances". */
  unit: string;
}

/**
 * Every feature a plan or a license can include. A key must be listed here
 * before a plan, a license or a flag rule can name it, so a typo cannot
 * grant or withhold anything.
 */
export const ENTITLEMENT_FEATURES = {} as const satisfies Record<string, EntitlementDefinition>;

/** Every limit a plan sets. */
export const ENTITLEMENT_LIMITS = {} as const satisfies Record<string, EntitlementLimitDefinition>;

export type EntitlementFeatureKey = keyof typeof ENTITLEMENT_FEATURES;
export type EntitlementLimitKey = keyof typeof ENTITLEMENT_LIMITS;

export type PlanTier = "free" | "pro" | "enterprise";

export interface Plan {
  features: readonly EntitlementFeatureKey[];
  /** Every limit, so a new one cannot be left out of a plan by accident. Null is unlimited. */
  limits: Record<EntitlementLimitKey, number | null>;
}

/** What each tier includes. A license can add features beyond its tier's. */
export const PLANS: Record<PlanTier, Plan> = {
  free: { features: [], limits: {} },
  pro: { features: [], limits: {} },
  enterprise: { features: [], limits: {} },
};

const ENTITLEMENT_FEATURE_KEYS: ReadonlySet<string> = new Set(Object.keys(ENTITLEMENT_FEATURES));

export function isEntitlementFeatureKey(key: string): key is EntitlementFeatureKey {
  return ENTITLEMENT_FEATURE_KEYS.has(key);
}

/** The plans and known features entitlements resolve against; tests pass their own. */
export interface EntitlementCatalog {
  plans: Record<PlanTier, Plan>;
  features: ReadonlySet<string>;
}

const CATALOG: EntitlementCatalog = { plans: PLANS, features: ENTITLEMENT_FEATURE_KEYS };

export interface LicenseRow {
  tier: PlanTier;
  features: readonly string[];
  expiresAt?: number;
}

export interface Entitlements {
  tier: PlanTier;
  features: readonly EntitlementFeatureKey[];
  limits: Record<EntitlementLimitKey, number | null>;
}

/**
 * An account's entitlements from its license. No license, or an expired one,
 * is the free plan: losing a paid plan never leaves an account with less than
 * free. License features no longer listed in ENTITLEMENT_FEATURES are ignored.
 */
export function resolveEntitlements(
  license: LicenseRow | null,
  nowMs: number,
  catalog: EntitlementCatalog = CATALOG
): Entitlements {
  const active = license !== null && (license.expiresAt === undefined || license.expiresAt > nowMs);
  const tier = active ? license.tier : "free";
  const plan = catalog.plans[tier];
  const features = new Set<EntitlementFeatureKey>(plan.features);
  if (active) {
    for (const feature of license.features) {
      if (catalog.features.has(feature)) {
        features.add(feature as EntitlementFeatureKey);
      }
    }
  }
  return { tier, features: [...features].sort(), limits: { ...plan.limits } };
}

/**
 * Whether `usage` fits under a limit. A missing limit is a programming error,
 * not "unlimited": every plan lists every limit.
 */
export function isWithinLimit(entitlements: Entitlements, key: EntitlementLimitKey, usage: number): boolean {
  const limit = entitlements.limits[key];
  if (limit === undefined) {
    throw new Error(`Plan "${entitlements.tier}" does not set limit "${key}"`);
  }
  return limit === null || usage <= limit;
}
