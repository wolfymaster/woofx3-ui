import type { MutationCtx } from "../_generated/server";
import type { LimitValue } from "../lib/entitlements";
import type { PlanTier } from "../lib/organization";
import { planByKey, upsertPlan } from "../lib/plans";

// The Starter and Pro plan rows, exactly as the pricing page promises them.
// Production gets them as data, through the `plans:upsert` commands in
// docs/patterns/entitlements.md; previews get them from seeds/preview.ts.
// plans.test.ts pins these against a copy of the pricing table, so changing
// the pricing page means changing both. The page's GB are read as GiB, the
// unit of the storage limits.

const GiB = 1024 * 1024 * 1024;

export interface PlanSeed {
  key: PlanTier;
  name: string;
  features: string[];
  limits: LimitValue[];
  offered: boolean;
}

export const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    key: "starter",
    name: "Starter",
    features: [],
    limits: [
      { key: "org.members", value: 5 },
      { key: "storage.moduleStorageBytes", value: 50 * GiB },
      { key: "storage.hostedAssetBytes", value: 100 * GiB },
      { key: "analytics.retentionDays", value: 30 },
    ],
    offered: true,
  },
  {
    key: "pro",
    name: "Pro",
    features: ["business", "marketplace.premiumIncluded", "userPages.customDomain"],
    limits: [
      { key: "org.members", value: null },
      { key: "storage.moduleStorageBytes", value: 100 * GiB },
      { key: "storage.hostedAssetBytes", value: 500 * GiB },
      { key: "analytics.retentionDays", value: 90 },
    ],
    offered: true,
  },
];

/** Inserts the tier plans that are missing; existing rows are operators' and are left alone. */
export async function seedMissingTierPlans(ctx: MutationCtx, actor: string): Promise<string[]> {
  const inserted: string[] = [];
  for (const seed of PLAN_SEEDS) {
    if ((await planByKey(ctx, seed.key)) === null) {
      await upsertPlan(ctx, seed, actor);
      inserted.push(seed.key);
    }
  }
  return inserted;
}
