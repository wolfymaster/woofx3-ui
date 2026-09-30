import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { APPLY_CLAIM_TTL_MS, nextApplyDelay, packStatusFromOutcomes } from "./lib/setupApply";
import { starterPacksForInterests } from "./lib/setupInterests";
import { logger } from "./logger";
import type { MarketplaceInstallResult } from "./marketplace";
import type { SetupModuleInstall, SetupPackInstall } from "./setup";
import { installStarterPackWithDefaults } from "./starterPacks";

// Applies the choices made at setup to the engine: installs each chosen
// module from the marketplace, then the starter packs for the chosen
// interests. Scheduled when setup finishes on a registered engine, when the
// engine registers after setup finished, and on retry. Safe to run again:
// installed modules are skipped, and the starter pack ledger skips installed
// items.

// Bounds the read of the instance's installed modules.
const MAX_INSTALLED_MODULES = 200;

const moduleInstallValidator = v.object({
  marketplaceModuleId: v.string(),
  status: v.union(v.literal("installed"), v.literal("needs_approval"), v.literal("failed")),
  moduleKey: v.optional(v.string()),
  unapproved: v.optional(v.array(v.string())),
  error: v.optional(v.string()),
});

const packInstallValidator = v.object({
  packId: v.string(),
  status: v.union(v.literal("installed"), v.literal("pending"), v.literal("failed")),
  error: v.optional(v.string()),
});

type ApplyPlan = Pick<Doc<"instanceSetup">, "platforms"> & {
  interests: string[];
  moduleInstalls: SetupModuleInstall[];
  packInstalls: SetupPackInstall[];
  attempts: number;
};

/**
 * Reserves the instance's setup for one apply run, or returns null when there
 * is nothing to apply yet (setup unfinished, engine unregistered) or another
 * run holds it.
 */
export const claim = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ApplyPlan | null> => {
    const [row, instance] = await Promise.all([
      ctx.db
        .query("instanceSetup")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first(),
      ctx.db.get(instanceId),
    ]);
    if (!row?.completedAt || !instance?.clientId) {
      return null;
    }
    const now = Date.now();
    if (row.applyClaimedAt !== undefined && now - row.applyClaimedAt < APPLY_CLAIM_TTL_MS) {
      return null;
    }
    const attempts = (row.applyAttempts ?? 0) + 1;
    await ctx.db.patch(row._id, { applyClaimedAt: now, applyAttempts: attempts, updatedAt: now });

    // A module the engine already has, e.g. on an instance set up before this
    // wizard existed, counts as installed rather than being installed again.
    const repository = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_INSTALLED_MODULES);
    const alreadyInstalled = new Map<string, string>();
    for (const module of repository) {
      if (module.status === "installed" && module.moduleKey) {
        alreadyInstalled.set(module.moduleKey.split(":")[0], module.moduleKey);
      }
    }
    const recorded = new Map((row.moduleInstalls ?? []).map((entry) => [entry.marketplaceModuleId, entry]));
    const moduleInstalls = row.platforms.flatMap((platform): SetupModuleInstall[] => {
      const moduleKey = alreadyInstalled.get(platform.marketplaceModuleId);
      if (moduleKey !== undefined) {
        return [{ marketplaceModuleId: platform.marketplaceModuleId, status: "installed", moduleKey }];
      }
      const entry = recorded.get(platform.marketplaceModuleId);
      return entry ? [entry] : [];
    });

    return {
      platforms: row.platforms,
      interests: row.interests ?? [],
      moduleInstalls,
      packInstalls: row.packInstalls ?? [],
      attempts,
    };
  },
});

/** Stores a run's results, releases the claim, and schedules the next retry when packs are still pending. */
export const record = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleInstalls: v.array(moduleInstallValidator),
    packInstalls: v.array(packInstallValidator),
    attempts: v.number(),
  },
  handler: async (ctx, { instanceId, moduleInstalls, packInstalls, attempts }) => {
    const row = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!row) {
      return;
    }
    const delay = packInstalls.some((pack) => pack.status === "pending") ? nextApplyDelay(attempts) : null;
    const settledPacks =
      delay === null
        ? packInstalls.map(
            (pack): SetupPackInstall =>
              pack.status === "pending"
                ? { packId: pack.packId, status: "failed", error: pack.error ?? "Timed out waiting to install." }
                : pack
          )
        : packInstalls;
    await ctx.db.patch(row._id, {
      moduleInstalls,
      packInstalls: settledPacks,
      applyClaimedAt: undefined,
      updatedAt: Date.now(),
    });
    if (delay !== null) {
      await ctx.scheduler.runAfter(delay, internal.setupApply.run, { instanceId });
    }
  },
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const run = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const plan: ApplyPlan | null = await ctx.runMutation(internal.setupApply.claim, { instanceId });
    if (!plan) {
      return;
    }

    const previousModules = new Map(plan.moduleInstalls.map((entry) => [entry.marketplaceModuleId, entry]));
    const moduleInstalls: SetupModuleInstall[] = [];
    for (const platform of plan.platforms) {
      const previous = previousModules.get(platform.marketplaceModuleId);
      if (previous?.status === "installed") {
        moduleInstalls.push(previous);
        continue;
      }
      try {
        const result: MarketplaceInstallResult = await ctx.runAction(internal.marketplace.installApprovedModule, {
          instanceId,
          marketplaceModuleId: platform.marketplaceModuleId,
          approvedPermissions: platform.approvedPermissions,
        });
        moduleInstalls.push(
          result.status === "installed"
            ? { marketplaceModuleId: platform.marketplaceModuleId, status: "installed", moduleKey: result.moduleKey }
            : {
                marketplaceModuleId: platform.marketplaceModuleId,
                status: "needs_approval",
                unapproved: result.unapproved,
              }
        );
      } catch (err) {
        logger.warn("setup: module install failed", {
          instanceId,
          marketplaceModuleId: platform.marketplaceModuleId,
          error: errorMessage(err),
        });
        moduleInstalls.push({
          marketplaceModuleId: platform.marketplaceModuleId,
          status: "failed",
          error: errorMessage(err),
        });
      }
    }

    const installedModuleIds = moduleInstalls
      .filter((entry) => entry.status === "installed")
      .map((entry) => entry.marketplaceModuleId);
    const previousPacks = new Map(plan.packInstalls.map((entry) => [entry.packId, entry]));
    const packInstalls: SetupPackInstall[] = [];
    for (const packId of starterPacksForInterests(plan.interests, installedModuleIds)) {
      const previous = previousPacks.get(packId);
      if (previous?.status === "installed") {
        packInstalls.push(previous);
        continue;
      }
      try {
        const outcomes = await installStarterPackWithDefaults(ctx, instanceId, packId);
        packInstalls.push({ packId, ...packStatusFromOutcomes(outcomes) });
      } catch (err) {
        packInstalls.push({ packId, status: "failed", error: errorMessage(err) });
      }
    }

    await ctx.runMutation(internal.setupApply.record, {
      instanceId,
      moduleInstalls,
      packInstalls,
      attempts: plan.attempts,
    });
  },
});
