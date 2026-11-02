import { DEFAULT_ALERT_ITEMS } from "@shared/default-seed";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation } from "./_generated/server";
import { applyDefaultSeed, type DefaultSeedRecord } from "./defaultSeed";
import { defaultSeedValidator } from "./lib/defaultSeedValidator";
import { installedListing } from "./lib/marketplaceInstallIdentity";
import { isPreviewDeployment } from "./lib/previewDeployment";
import {
  APPLY_CLAIM_TTL_MS,
  type ImplicitPlatform,
  nextApplyDelay,
  packStatusFromOutcomes,
  platformsToApply,
  seedsDefaults,
  settlePending,
} from "./lib/setupApply";
import { starterPacksForInterests } from "./lib/setupInterests";
import { setupNeedsTwitch } from "./lib/setupPlatforms";
import { logger } from "./logger";
import type { MarketplaceInstallResult } from "./marketplace";
import type { SetupModuleInstall, SetupPackInstall } from "./setup";
import { installStarterPackWithDefaults } from "./starterPacks";

// Applies the choices made at setup to the engine: installs each chosen
// module from the marketplace, then the default seed (overlay scene and
// alerts), then the starter packs for the chosen interests. Scheduled when
// setup finishes on a registered engine, when the engine registers after setup
// finished, and on retry. Safe to run any time after platforms are chosen, on a
// registered engine: what needs a module's triggers waits for them on the retry
// backoff, nothing needs a linked Twitch account, and installed modules and
// ledger items are skipped.

// Bounds the read of the instance's installed modules.
const MAX_INSTALLED_MODULES = 200;
// Bounds the read of an instance's platform links, a handful per instance.
const MAX_PLATFORM_LINKS = 20;

const moduleInstallValidator = v.object({
  marketplaceModuleId: v.string(),
  status: v.union(v.literal("installed"), v.literal("needs_approval"), v.literal("failed")),
  moduleKey: v.optional(v.string()),
  unapproved: v.optional(v.array(v.string())),
  unapprovedLocalEndpoints: v.optional(v.array(v.string())),
  error: v.optional(v.string()),
});

const packInstallValidator = v.object({
  packId: v.string(),
  status: v.union(v.literal("installed"), v.literal("pending"), v.literal("failed")),
  error: v.optional(v.string()),
});

type ChosenPlatform = Doc<"instanceSetup">["platforms"][number];

type ApplyPlan = {
  platforms: (ChosenPlatform | ImplicitPlatform)[];
  interests: string[];
  moduleInstalls: SetupModuleInstall[];
  packInstalls: SetupPackInstall[];
  seedsDefaults: boolean;
  defaultSeed: DefaultSeedRecord | undefined;
  attempts: number;
};

/**
 * Reserves the instance's setup for one apply run, or returns null when there
 * is nothing to apply yet (platforms not chosen, no Twitch link where one is
 * required, engine unregistered) or another
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
    if (!row?.platformsChosenAt || !instance?.clientId) {
      return null;
    }
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_PLATFORM_LINKS);
    if (
      setupNeedsTwitch(row.twitchSkippedAt !== undefined, isPreviewDeployment()) &&
      !links.some((link) => link.platform === "twitch")
    ) {
      return null;
    }
    const now = Date.now();
    if (row.applyClaimedAt !== undefined && now - row.applyClaimedAt < APPLY_CLAIM_TTL_MS) {
      return null;
    }
    const attempts = (row.applyAttempts ?? 0) + 1;
    await ctx.db.patch(row._id, { applyClaimedAt: now, applyAttempts: attempts, updatedAt: now });
    await ctx.scheduler.runAfter(APPLY_CLAIM_TTL_MS, internal.setupApply.recoverDiedRun, {
      instanceId,
      claimedAt: now,
    });

    // A module the engine already has, e.g. on an instance set up before this
    // wizard existed, counts as installed rather than being installed again.
    // Any edition of it counts: a platform named by its first edition's
    // listing id must not reinstall that edition over a later one.
    const repository = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_INSTALLED_MODULES);
    const alreadyInstalled = new Map<string, string>();
    for (const module of repository) {
      const installed = installedListing(module);
      if (module.status === "installed" && module.moduleKey && installed) {
        alreadyInstalled.set(installed.manifestId, module.moduleKey);
        alreadyInstalled.set(installed.listingId, module.moduleKey);
      }
    }
    const recorded = new Map((row.moduleInstalls ?? []).map((entry) => [entry.marketplaceModuleId, entry]));
    const platforms = platformsToApply(row.platforms, isPreviewDeployment());
    const moduleInstalls = platforms.flatMap((platform): SetupModuleInstall[] => {
      const moduleKey = alreadyInstalled.get(platform.marketplaceModuleId);
      if (moduleKey !== undefined) {
        return [{ marketplaceModuleId: platform.marketplaceModuleId, status: "installed", moduleKey }];
      }
      const entry = recorded.get(platform.marketplaceModuleId);
      return entry ? [entry] : [];
    });

    return {
      platforms,
      interests: row.interests ?? [],
      moduleInstalls,
      packInstalls: row.packInstalls ?? [],
      seedsDefaults: seedsDefaults(row),
      defaultSeed: row.defaultSeed,
      attempts,
    };
  },
});

/** Stores a run's results, releases the claim, and schedules the next retry when anything is still pending. */
export const record = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleInstalls: v.array(moduleInstallValidator),
    packInstalls: v.array(packInstallValidator),
    defaultSeed: v.optional(defaultSeedValidator),
    attempts: v.number(),
  },
  handler: async (ctx, { instanceId, moduleInstalls, packInstalls, defaultSeed, attempts }) => {
    const row = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!row) {
      return;
    }
    const pending = [...packInstalls, ...(defaultSeed ? [defaultSeed.scene, ...defaultSeed.alerts] : [])].some(
      (entry) => entry.status === "pending"
    );
    const delay = pending ? nextApplyDelay(attempts) : null;
    const settled = delay === null;
    await ctx.db.patch(row._id, {
      moduleInstalls,
      packInstalls: settled ? packInstalls.map(settlePending) : packInstalls,
      defaultSeed:
        settled && defaultSeed
          ? { ...defaultSeed, scene: settlePending(defaultSeed.scene), alerts: defaultSeed.alerts.map(settlePending) }
          : defaultSeed,
      applyClaimedAt: undefined,
      updatedAt: Date.now(),
    });
    if (delay !== null) {
      await ctx.scheduler.runAfter(delay, internal.setupApply.run, { instanceId });
    }
  },
});

/**
 * Scheduled with every claim, because a run that dies records nothing and so
 * schedules nothing, which would leave the overlay page preparing for good. A
 * claim still held at its limit gets another run while tries remain; after that
 * the seed settles as failed, for the page to offer Try again.
 */
export const recoverDiedRun = internalMutation({
  args: { instanceId: v.id("instances"), claimedAt: v.number() },
  handler: async (ctx, { instanceId, claimedAt }) => {
    const row = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (row?.applyClaimedAt !== claimedAt) {
      return;
    }
    logger.warn("setup: apply run died holding its claim", { instanceId, attempts: row.applyAttempts });
    if (nextApplyDelay(row.applyAttempts ?? 1) !== null) {
      await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
      return;
    }
    const seed: DefaultSeedRecord = row.defaultSeed ?? {
      scene: { status: "pending" },
      alerts: DEFAULT_ALERT_ITEMS.map((item) => ({ itemId: item.id, status: "pending" })),
    };
    await ctx.db.patch(row._id, {
      applyClaimedAt: undefined,
      updatedAt: Date.now(),
      ...(seedsDefaults(row)
        ? {
            defaultSeed: { ...seed, scene: settlePending(seed.scene), alerts: seed.alerts.map(settlePending) },
          }
        : {}),
    });
  },
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Installs a platform. An implicit one is approved for what its build asks,
 * since a preview has nobody who chose it.
 */
async function installPlatform(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  platform: ChosenPlatform | ImplicitPlatform
): Promise<MarketplaceInstallResult> {
  const install = (approvedPermissions: string[], approvedLocalEndpoints: string[]) =>
    ctx.runAction(internal.marketplace.installApprovedModule, {
      instanceId,
      marketplaceModuleId: platform.marketplaceModuleId,
      approvedPermissions,
      approvedLocalEndpoints,
    });
  const result: MarketplaceInstallResult = await install(
    platform.approvedPermissions,
    platform.approvedLocalEndpoints ?? []
  );
  if (result.status === "needs_approval" && "implicit" in platform) {
    return await install(result.unapproved, result.unapprovedLocalEndpoints);
  }
  return result;
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
        const result = await installPlatform(ctx, instanceId, platform);
        moduleInstalls.push(
          result.status === "installed"
            ? { marketplaceModuleId: platform.marketplaceModuleId, status: "installed", moduleKey: result.moduleKey }
            : {
                marketplaceModuleId: platform.marketplaceModuleId,
                status: "needs_approval",
                unapproved: result.unapproved,
                unapprovedLocalEndpoints: result.unapprovedLocalEndpoints,
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

    const defaultSeed = plan.seedsDefaults ? await applyDefaultSeed(ctx, instanceId, plan.defaultSeed) : undefined;

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
      defaultSeed,
      attempts: plan.attempts,
    });
  },
});
