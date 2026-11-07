import { type Infer, v } from "convex/values";

// The organization is stored as `accounts`: its id is the marketplace buyer
// identity and the ops API's `/api/ops/accounts`, so the table keeps its name
// and code keeps saying `account`. User-facing copy says "organization".

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const ENGINE_ROLES = ["owner", "admin", "member"] as const;

/** `accountMembers.role`: a user's role in the organization. */
export const orgRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
/** `instanceMembers.role`: a user's role on one engine, independent of their org role. */
export const engineRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

export type OrgRole = Infer<typeof orgRoleValidator>;
export type EngineRole = Infer<typeof engineRoleValidator>;

export const PLAN_TIERS = ["starter", "pro"] as const;
export const BILLING_INTERVALS = ["month", "year"] as const;
export const SUBSCRIPTION_STATES = ["trialing", "active", "past_due", "suspended", "exempt"] as const;

/** The billed plan. Wire values, shared with the Stripe price lookup keys `woofx3_<tier>_<interval>`. */
export const planTierValidator = v.union(v.literal("starter"), v.literal("pro"));
/** Matches the backoffice's `backoffice_plan_prices.billing_interval`. */
export const billingIntervalValidator = v.union(v.literal("month"), v.literal("year"));
export const subscriptionStateValidator = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("suspended"),
  v.literal("exempt")
);

export type PlanTier = Infer<typeof planTierValidator>;
export type BillingInterval = Infer<typeof billingIntervalValidator>;
export type SubscriptionState = Infer<typeof subscriptionStateValidator>;
