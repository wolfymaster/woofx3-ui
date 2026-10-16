import { isAssignmentActive } from "../entitlements";

/**
 * How many accounts are on each plan, as entitlements resolve it: an account
 * with an active assignment naming a plan is on that plan; every other account
 * (no assignment, an expired one, or one that only adds overrides) is on the
 * default plan. Pure, so the counting rule is tested apart from Convex paging.
 */

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  offered: boolean;
  isDefault: boolean;
}

export interface AssignmentRow {
  planId?: string;
  expiresAt?: number;
}

export interface PlanCountDto {
  key: string;
  name: string;
  offered: boolean;
  isDefault: boolean;
  accounts: number;
}

export interface PlanCountsDto {
  plans: PlanCountDto[];
  totalAccounts: number;
  /** Accounts on no plan: there is no default plan and they have no active assignment. */
  withoutPlan: number;
  countedAt: number;
}

export function tallyPlanAccounts(
  plans: readonly PlanRow[],
  assignments: readonly AssignmentRow[],
  totalAccounts: number,
  nowMs: number
): PlanCountsDto {
  const counts = new Map(plans.map((plan) => [plan.id, 0]));
  let assigned = 0;
  for (const assignment of assignments) {
    const active = isAssignmentActive({ ...assignment, addFeatures: [], removeFeatures: [], limits: [] }, nowMs);
    if (assignment.planId !== undefined && active) {
      if (!counts.has(assignment.planId)) {
        // deletePlan refuses a plan any account is on.
        throw new Error(`An assignment names plan ${assignment.planId}, which does not exist`);
      }
      counts.set(assignment.planId, (counts.get(assignment.planId) ?? 0) + 1);
      assigned += 1;
    }
  }
  // The pages are separate reads, so an account deleted mid-count could leave more assignments than accounts.
  const onDefault = Math.max(0, totalAccounts - assigned);
  const fallback = plans.find((plan) => plan.isDefault);
  if (fallback) {
    counts.set(fallback.id, (counts.get(fallback.id) ?? 0) + onDefault);
  }
  return {
    plans: plans
      .map((plan) => ({
        key: plan.key,
        name: plan.name,
        offered: plan.offered,
        isDefault: plan.isDefault,
        accounts: counts.get(plan.id) ?? 0,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    totalAccounts,
    withoutPlan: fallback ? 0 : onDefault,
    countedAt: nowMs,
  };
}
