import type { Infer } from "convex/values";
import { type LimitValue, validateEntitlementInput } from "../entitlements";
import type { ParseResult } from "../notifications";
import {
  BILLING_INTERVALS,
  type BillingInterval,
  lifecycleReasonValidator,
  PLAN_TIERS,
  type PlanTier,
  SUBSCRIPTION_STATES,
  type SubscriptionState,
} from "../organization";
import { orgBillingFields } from "../orgBilling";

// The body of the plane's billing projection push. Shape and range checks run
// here so a malformed push is a 400; whether it is newer than what Convex holds
// is decided where it is applied.

type ProjectionFields = { [K in keyof typeof orgBillingFields]: Infer<(typeof orgBillingFields)[K]> };
export type BillingProjectionRequest = { accountId: string } & ProjectionFields;

const REASONS: readonly string[] = lifecycleReasonValidator.members.map((member) => member.value);

const fail = (message: string) => ({ ok: false as const, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isNullableTime = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const FIELDS: readonly string[] = ["accountId", ...Object.keys(orgBillingFields)];

/** An `OrgBillingProjection` (spec: billing in the management plane), times in epoch ms. */
export function parseBillingProjectionRequest(body: unknown): ParseResult<BillingProjectionRequest> {
  if (!isRecord(body)) {
    return fail("body must be a JSON object");
  }
  const extra = Object.keys(body).find((key) => !FIELDS.includes(key));
  if (extra !== undefined) {
    return fail(`Unknown field "${extra}"`);
  }
  const { accountId, version, tier, addOns, standing, reason, interval, hasProviderSubscription, discount, overrides } =
    body;
  if (typeof accountId !== "string" || accountId === "") {
    return fail("accountId must be a non-empty string");
  }
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    return fail("version must be a whole number of at least 1");
  }
  if (tier !== null && !PLAN_TIERS.includes(tier as PlanTier)) {
    return fail(`tier must be null or one of ${PLAN_TIERS.join(", ")}`);
  }
  if (!isStringArray(addOns)) {
    return fail("addOns must be an array of strings");
  }
  if (!SUBSCRIPTION_STATES.includes(standing as SubscriptionState)) {
    return fail(`standing must be one of ${SUBSCRIPTION_STATES.join(", ")}`);
  }
  if (reason !== null && !REASONS.includes(reason as string)) {
    return fail(`reason must be null or one of ${REASONS.join(", ")}`);
  }
  if (standing === "suspended" && reason === null) {
    return fail("a suspended standing needs a reason");
  }
  if (standing === "trialing" && body.trialEndsAt === null) {
    return fail("a trialing standing needs trialEndsAt");
  }
  if (interval !== null && !BILLING_INTERVALS.includes(interval as BillingInterval)) {
    return fail(`interval must be null or one of ${BILLING_INTERVALS.join(", ")}`);
  }
  if (typeof hasProviderSubscription !== "boolean") {
    return fail("hasProviderSubscription must be a boolean");
  }
  for (const field of ["trialEndsAt", "graceEndsAt", "periodEnd", "exemptUntil", "spinDownAt"] as const) {
    if (!isNullableTime(body[field])) {
      return fail(`${field} must be null or epoch milliseconds`);
    }
  }
  if (
    discount !== null &&
    !(isRecord(discount) && Object.keys(discount).length === 1 && typeof discount.label === "string")
  ) {
    return fail("discount must be null or { label: string }");
  }
  if (!isRecord(overrides) || !isStringArray(overrides.addFeatures) || !isStringArray(overrides.removeFeatures)) {
    return fail("overrides needs addFeatures and removeFeatures as arrays of strings, and limits as an object");
  }
  const limits = overrides.limits;
  if (!isRecord(limits)) {
    return fail("overrides.limits must be an object of amounts");
  }
  const limitList: LimitValue[] = [];
  for (const [key, value] of Object.entries(limits)) {
    if (value !== null && typeof value !== "number") {
      return fail(`limit "${key}" must be a number, or null for unlimited`);
    }
    limitList.push({ key, value });
  }
  try {
    validateEntitlementInput({
      features: overrides.addFeatures,
      removeFeatures: overrides.removeFeatures,
      limits: limitList,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "invalid overrides");
  }
  return {
    ok: true,
    value: {
      accountId,
      version,
      tier: tier as PlanTier | null,
      addOns,
      standing: standing as SubscriptionState,
      reason: reason as BillingProjectionRequest["reason"],
      trialEndsAt: body.trialEndsAt as number | null,
      graceEndsAt: body.graceEndsAt as number | null,
      periodEnd: body.periodEnd as number | null,
      interval: interval as BillingInterval | null,
      exemptUntil: body.exemptUntil as number | null,
      spinDownAt: body.spinDownAt as number | null,
      hasProviderSubscription,
      discount: discount as BillingProjectionRequest["discount"],
      overrides: { addFeatures: overrides.addFeatures, removeFeatures: overrides.removeFeatures, limits: limitList },
    },
  };
}
