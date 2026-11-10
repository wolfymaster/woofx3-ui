import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Inserts an active Starter projection for the org, with any field overridden. */
export function insertProjection(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  projection: Partial<Doc<"orgBilling">> = {}
): Promise<Id<"orgBilling">> {
  return ctx.db.insert("orgBilling", {
    accountId,
    version: 1,
    tier: "starter",
    addOns: [],
    standing: "active",
    reason: null,
    trialEndsAt: null,
    graceEndsAt: null,
    periodEnd: null,
    interval: null,
    exemptUntil: null,
    spinDownAt: null,
    hasProviderSubscription: false,
    discount: null,
    overrides: { addFeatures: [], removeFeatures: [], limits: [] },
    updatedAt: 1,
    ...projection,
  });
}
