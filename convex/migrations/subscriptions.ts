import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { BILLING_LIFECYCLE } from "../lib/billingLifecycle";
import { isAssignmentActive } from "../lib/entitlements";
import { PLAN_TIERS, type PlanTier } from "../lib/organization";
import { applyTransition, subscriptionFor } from "../lib/subscriptions";
import { logger } from "../logger";
import { migrations } from "./index";

// Gives existing orgs their subscription. The end state does not depend on
// the order: a comped org that seedSubscriptions reached first is moved from
// its migration trial to its exemption. Running exemptionsFromPlanAssignments
// first still saves those orgs a trial they would not keep.

const MIGRATION = "migration";

export function isPlanTier(key: string): key is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(key);
}

/** Whether the org has a managed engine that hasn't been deleted. */
async function hasManagedEngine(ctx: QueryCtx, accountId: Id<"accounts">): Promise<boolean> {
  const rows = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(50);
  return rows.some((row) => row.status !== "deleted");
}

/** A trial seedSubscriptions started that nobody has paid for or changed since. */
function isMigrationTrial(row: Doc<"subscriptions">): boolean {
  return row.origin === MIGRATION && row.state === "trialing" && row.providerSubscriptionId === undefined;
}

/**
 * M6: an active operator plan assignment becomes an exemption on that plan,
 * until the assignment's expiry. A plan key that is not a tier is reported and
 * skipped. The assignment's planId stays until the default-plan cleanup.
 * An org that already has a subscription is left as it is, unless that
 * subscription is the trial seedSubscriptions gave it.
 */
export const exemptionsFromPlanAssignments = migrations.define({
  table: "accountPlans",
  migrateOne: async (ctx, assignment) => {
    const now = Date.now();
    if (assignment.planId === undefined || !isAssignmentActive(assignment, now)) {
      return;
    }
    const existing = await subscriptionFor(ctx, assignment.accountId);
    if (existing !== null && !isMigrationTrial(existing)) {
      return;
    }
    const plan = await ctx.db.get(assignment.planId);
    if (plan === null) {
      throw new Error(`exemptionsFromPlanAssignments: ${assignment._id} names missing plan ${assignment.planId}`);
    }
    if (!isPlanTier(plan.key)) {
      logger.warn("exemptionsFromPlanAssignments: plan is not a tier; not exempted", {
        accountId: assignment.accountId,
        planKey: plan.key,
      });
      return;
    }
    const result = await applyTransition(ctx, {
      accountId: assignment.accountId,
      event: { kind: "ExemptionGranted", plan: plan.key, until: assignment.expiresAt ?? null },
      now,
      actor: MIGRATION,
      origin: "migration",
    });
    if (!result.ok) {
      throw new Error(`exemptionsFromPlanAssignments: ${result.error.event} illegal from ${result.error.from}`);
    }
  },
});

/**
 * M3: an org with a managed engine and no subscription starts a Starter
 * trial whose first billing evaluation is migrationBillingDelayDays out.
 */
export const seedSubscriptions = migrations.define({
  table: "accounts",
  migrateOne: async (ctx, account) => {
    if ((await subscriptionFor(ctx, account._id)) !== null || !(await hasManagedEngine(ctx, account._id))) {
      return;
    }
    const result = await applyTransition(ctx, {
      accountId: account._id,
      event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.migrationBillingDelayDays },
      now: Date.now(),
      actor: MIGRATION,
      origin: "migration",
    });
    if (!result.ok) {
      throw new Error(`seedSubscriptions: ${result.error.event} illegal from ${result.error.from}`);
    }
  },
});
