import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_DASHBOARD_LAYOUT_ID, DEFAULT_DASHBOARD_WIDGETS } from "@shared/default-seed";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { ensureOwnAccount } from "./accounts";
import { readMemberRole } from "./instances";
import { requireInstanceRole } from "./lib/instanceAccess";
import { isMaintenanceConfigured } from "./lib/maintenanceClient";
import { isPreviewDeployment } from "./lib/previewDeployment";
import { reopenFailed, seedsDefaults } from "./lib/setupApply";
import {
  type ChosenSetupPlatform,
  curatedForDeployment,
  NO_SETUP_PLATFORMS_MESSAGE,
  setupChoiceError,
  setupNeedsTwitch,
} from "./lib/setupPlatforms";
import { canManageTwitchLink } from "./lib/twitchLinkPolicy";
import { findOrCreateManagedInstance, markFirstRun, startTrialIfNew } from "./provisioningInternal";

// Bounds for reads of tables that hold a handful of rows per key.
const MAX_SETUP_PLATFORMS = 50;
const MAX_PLATFORM_LINKS = 20;

const chosenPlatformValidator = v.object({
  marketplaceModuleId: v.string(),
  name: v.optional(v.string()),
  approvedPermissions: v.array(v.string()),
  approvedLocalEndpoints: v.optional(v.array(v.string())),
});

export type SetupModuleInstall = NonNullable<Doc<"instanceSetup">["moduleInstalls"]>[number];
export type SetupPackInstall = NonNullable<Doc<"instanceSetup">["packInstalls"]>[number];

export interface SetupStatus {
  platforms: ChosenSetupPlatform[];
  /** Marketplace ids of the platforms setup cannot finish without. */
  requiredModuleIds: string[];
  completedAt: number | null;
  /** The instance's Twitch link, whether or not its tokens still work. */
  twitchUsername: string | null;
  /**
   * Whether setup cannot finish, and the app sends an admin back to setup, until
   * Twitch is connected. Always true except on a preview deployment where the
   * connection was skipped (`setupNeedsTwitch`).
   */
  twitchRequired: boolean;
  /** Whether the connect screen offers "Skip for now": a preview deployment only. */
  canSkipTwitch: boolean;
  /** Whether the engine waits on the user naming it: no derived username was usable, or it was deleted. */
  usernameNeeded: boolean;
  /** Whether the viewer owns the account, the only one who can name and be billed for its engine. */
  ownsAccount: boolean;
  /** Whether the viewer may choose platforms and connect Twitch: only an owner or admin can. */
  canManageSetup: boolean;
  /** Whether the setup wizard has opened for the viewer before. */
  setupSeen: boolean;
  /** Whether the engine has answered the registration handshake. */
  engineRegistered: boolean;
  /** Whether woofx3 builds this instance's engine, rather than the user running their own. */
  managedEngine: boolean;
  /**
   * Whether finished setup still owes the overlay page: it is a first run, and
   * nobody has seen an alert play or skipped. An established instance never owes it.
   */
  overlayPending: boolean;
  /**
   * Chosen platforms whose installed module declares settings, such as an
   * account to authorize. Installing is not enough for these to work.
   */
  platformsNeedingSettings: string[];
  /** What applying the choices has done so far; empty until it first runs. */
  moduleInstalls: SetupModuleInstall[];
  packInstalls: SetupPackInstall[];
}

async function readSetupRow(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Doc<"instanceSetup"> | null> {
  return await ctx.db
    .query("instanceSetup")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
}

async function readTwitchLink(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Doc<"platformLinks"> | null> {
  const links = await ctx.db
    .query("platformLinks")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_PLATFORM_LINKS);
  return links.find((link) => link.platform === "twitch") ?? null;
}

/** The curated platforms, with what this deployment requires (`curatedForDeployment`). */
async function readCuratedPlatforms(ctx: QueryCtx): Promise<Doc<"setupPlatforms">[]> {
  const rows = await ctx.db.query("setupPlatforms").withIndex("by_sort_order").take(MAX_SETUP_PLATFORMS);
  return curatedForDeployment(rows, isPreviewDeployment());
}

function twitchRequiredFor(row: Doc<"instanceSetup"> | null): boolean {
  return setupNeedsTwitch(row?.twitchSkippedAt !== undefined, isPreviewDeployment());
}

/**
 * Applies the setup's choices now if the engine is registered. Otherwise
 * registration applies them (instances.applyRegistration).
 */
export async function scheduleApplyIfRegistered(ctx: MutationCtx, instanceId: Id<"instances">) {
  const instance = await ctx.db.get(instanceId);
  if (instance?.clientId) {
    await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
  }
}

function manifestDeclaresSettings(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object") {
    return false;
  }
  const settings = (manifest as { settings?: unknown }).settings;
  return Array.isArray(settings) && settings.length > 0;
}

/** Where the instance's setup stands, for the wizard and the onboarding guard. Null for a non-member. */
export const status = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SetupStatus | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const role = await readMemberRole(ctx, instanceId, userId);
    if (!role) {
      return null;
    }
    const [row, twitchLink, seen, instance, curated, provisioning] = await Promise.all([
      readSetupRow(ctx, instanceId),
      readTwitchLink(ctx, instanceId),
      ctx.db
        .query("userSetupSeen")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first(),
      ctx.db.get(instanceId),
      readCuratedPlatforms(ctx),
      ctx.db
        .query("engineProvisioning")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first(),
    ]);
    const account = instance ? await ctx.db.get(instance.accountId) : null;
    const platformsNeedingSettings: string[] = [];
    for (const install of row?.moduleInstalls ?? []) {
      if (install.status !== "installed" || !install.moduleKey) {
        continue;
      }
      const moduleKey = install.moduleKey;
      const module = await ctx.db
        .query("moduleRepository")
        .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", moduleKey))
        .first();
      if (manifestDeclaresSettings(module?.manifest)) {
        platformsNeedingSettings.push(install.marketplaceModuleId);
      }
    }
    return {
      platforms: row?.platforms ?? [],
      platformsNeedingSettings,
      requiredModuleIds: curated.filter((entry) => entry.required).map((entry) => entry.marketplaceModuleId),
      completedAt: row?.completedAt ?? null,
      twitchUsername: twitchLink?.platformUsername ?? null,
      twitchRequired: twitchRequiredFor(row),
      canSkipTwitch: isPreviewDeployment(),
      usernameNeeded:
        !instance?.clientId && (row?.usernameNeededAt !== undefined || provisioning?.status === "deleted"),
      ownsAccount: account?.ownerId === userId,
      canManageSetup: canManageTwitchLink(role),
      setupSeen: seen !== null,
      engineRegistered: Boolean(instance?.clientId),
      managedEngine: instance?.hosting === "managed",
      overlayPending: Boolean(row?.completedAt) && row?.overlayDone === undefined && row !== null && seedsDefaults(row),
      moduleInstalls: row?.moduleInstalls ?? [],
      packInstalls: row?.packInstalls ?? [],
    };
  },
});

/** Every required platform in the curated list must be included. */
async function assertValidChoice(ctx: QueryCtx, platforms: ChosenSetupPlatform[]) {
  const curated = await readCuratedPlatforms(ctx);
  if (curated.length === 0) {
    throw new Error(NO_SETUP_PLATFORMS_MESSAGE);
  }
  const requiredIds = curated.filter((entry) => entry.required).map((entry) => entry.marketplaceModuleId);
  const error = setupChoiceError(platforms, requiredIds);
  if (error) {
    throw new Error(error);
  }
}

/**
 * Holds what the connect card lists while the streamer is away at Twitch, for
 * `recordLinkConsent` once they approve. Only an unfinished first run has a
 * choice to make: elsewhere connecting is a reconnect, which changes nothing.
 */
export const prepareConnect = mutation({
  args: { instanceId: v.id("instances"), platforms: v.array(chosenPlatformValidator) },
  handler: async (ctx, { instanceId, platforms }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (row?.firstRunAt === undefined || row.platformsChosenAt !== undefined) {
      return;
    }
    await assertValidChoice(ctx, platforms);
    await ctx.db.patch(row._id, { pendingPlatforms: platforms, updatedAt: Date.now() });
  },
});

/**
 * Turns what the card listed into consent, now that Twitch has approved. Returns
 * the row as it then stands. A link made elsewhere has nothing held, so the
 * connect screen's Continue asks instead.
 */
export async function recordLinkConsent(ctx: MutationCtx, row: Doc<"instanceSetup">): Promise<Doc<"instanceSetup">> {
  if (row.platformsChosenAt !== undefined || row.pendingPlatforms === undefined) {
    return row;
  }
  const now = Date.now();
  const consent = {
    platforms: row.pendingPlatforms,
    platformsChosenAt: now,
    pendingPlatforms: undefined,
    updatedAt: now,
  };
  await ctx.db.patch(row._id, consent);
  return { ...row, ...consent };
}

/**
 * Gives the user a first dashboard panel, unless they already have one: a
 * dashboard they have arranged is never replaced.
 */
async function seedDashboard(ctx: MutationCtx, instanceId: Id<"instances">, userId: Id<"users">) {
  const existing = await ctx.db
    .query("dashboardLayouts")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  if (existing && (existing.panels ?? []).length > 0) {
    return;
  }
  const panels = [
    {
      id: crypto.randomUUID(),
      name: "Main",
      layoutId: DEFAULT_DASHBOARD_LAYOUT_ID,
      widgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
    },
  ];
  if (existing) {
    await ctx.db.patch(existing._id, { panels });
    return;
  }
  await ctx.db.insert("dashboardLayouts", { instanceId, userId, panels });
}

/**
 * Asks for the instance's first engine, when it is a managed one with none
 * requested. Registered and external instances have what they need.
 */
async function scheduleFirstEngine(ctx: MutationCtx, instanceId: Id<"instances">) {
  const instance = await ctx.db.get(instanceId);
  if (!instance || instance.clientId || instance.hosting !== "managed") {
    return;
  }
  const provisioning = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (!provisioning) {
    await ctx.scheduler.runAfter(0, internal.provisioning.startFirstEngine, { instanceId });
  }
}

/**
 * Everything that follows connecting the streaming platform: setup is marked
 * finished, the caller gets their dashboard, and the choices are applied now if
 * the engine is registered, otherwise when it registers. An engine is asked for
 * if there is none. It all happens at once, so leaving the app any time after
 * connecting never strands an account half set up. Safe to run again.
 */
export async function finishFirstRun(ctx: MutationCtx, row: Doc<"instanceSetup">, userId: Id<"users">) {
  const { instanceId } = row;
  await scheduleFirstEngine(ctx, instanceId);
  if (row.completedAt) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch(row._id, { completedAt: now, completedByUserId: userId, updatedAt: now });
  await seedDashboard(ctx, instanceId, userId);
  await scheduleApplyIfRegistered(ctx, instanceId);
  // An import queued during setup waits for setup to finish before applying.
  await ctx.scheduler.runAfter(0, internal.setupImports.resumeQueued, { instanceId });
}

/**
 * The connect screen's Continue, for a Twitch link already there. `platforms` is
 * what the screen listed, taken as the choice only if none was made: an existing
 * one is never overwritten. Refused where Twitch is required and not connected.
 */
export const complete = mutation({
  args: { instanceId: v.id("instances"), platforms: v.array(chosenPlatformValidator) },
  handler: async (ctx, { instanceId, platforms }) => {
    const userId = await requireInstanceRole(ctx, instanceId, "admin");
    const existing = await readSetupRow(ctx, instanceId);
    if (twitchRequiredFor(existing) && !(await readTwitchLink(ctx, instanceId))) {
      throw new Error("Connect Twitch before finishing setup");
    }
    if (existing?.platformsChosenAt) {
      await finishFirstRun(ctx, existing, userId);
      return;
    }
    await assertValidChoice(ctx, platforms);
    const now = Date.now();
    const choice = { platforms, platformsChosenAt: now, pendingPlatforms: undefined, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, choice);
    } else {
      await ctx.db.insert("instanceSetup", { instanceId, platforms, platformsChosenAt: now, updatedAt: now });
    }
    const row = await readSetupRow(ctx, instanceId);
    if (!row) {
      throw new Error("The setup just saved cannot be read");
    }
    await finishFirstRun(ctx, row, userId);
  },
});

/**
 * A preview deployment's way past the connect screen for an account that cannot
 * link Twitch. `platforms` is what the screen listed, so the module still
 * installs and its triggers can be tested.
 */
export const skipTwitch = mutation({
  args: { instanceId: v.id("instances"), platforms: v.array(chosenPlatformValidator) },
  handler: async (ctx, { instanceId, platforms }) => {
    if (!isPreviewDeployment()) {
      throw new Error("Twitch cannot be skipped here");
    }
    const userId = await requireInstanceRole(ctx, instanceId, "admin");
    const now = Date.now();
    const existing = await readSetupRow(ctx, instanceId);
    const choice = existing?.platformsChosenAt
      ? { twitchSkippedAt: now, updatedAt: now }
      : { platforms, platformsChosenAt: now, twitchSkippedAt: now, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, choice);
    } else {
      await ctx.db.insert("instanceSetup", {
        instanceId,
        platforms,
        platformsChosenAt: now,
        twitchSkippedAt: now,
        updatedAt: now,
      });
    }
    const row = await readSetupRow(ctx, instanceId);
    if (!row) {
      throw new Error("The setup just saved cannot be read");
    }
    await finishFirstRun(ctx, row, userId);
  },
});

/**
 * The account and instance a new user's connect screen works on, so Twitch can
 * link before anything has a real name: both start under the placeholder, and
 * connecting renames them. An engine the user runs is left alone, even one that
 * has not registered yet: its address is still theirs to retry.
 */
export const ensureFirstRun = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"instances">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    if (!isMaintenanceConfigured()) {
      throw new Error("Managed engines are not configured");
    }
    const account = await ensureOwnAccount(ctx, userId);
    const { instanceId, created } = await findOrCreateManagedInstance(ctx, account);
    if (created) {
      await markFirstRun(ctx, instanceId);
    }
    // Choosing a hosted engine is what starts the trial, so onboarding can say
    // so before the engine is built.
    await startTrialIfNew(ctx, account._id);
    return instanceId;
  },
});

/** Runs the apply again, e.g. after a module install failed. */
export const retryApply = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (!row?.platformsChosenAt) {
      throw new Error("Setup has nothing to apply yet");
    }
    if (twitchRequiredFor(row) && !(await readTwitchLink(ctx, instanceId))) {
      throw new Error("Connect Twitch before applying setup");
    }
    // Failed items go back to pending so the page shows the attempt, not the failure it replaces.
    const seed = row.defaultSeed;
    await ctx.db.patch(row._id, {
      applyAttempts: 0,
      updatedAt: Date.now(),
      ...(seed
        ? { defaultSeed: { ...seed, scene: reopenFailed(seed.scene), alerts: seed.alerts.map(reopenFailed) } }
        : {}),
    });
    await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
  },
});

/**
 * Approves the permissions and local endpoints a chosen module's current
 * build asks for, after its install came back needing approval, and installs
 * it again.
 */
export const approveModulePermissions = mutation({
  args: {
    instanceId: v.id("instances"),
    marketplaceModuleId: v.string(),
    approvedPermissions: v.array(v.string()),
    approvedLocalEndpoints: v.array(v.string()),
  },
  handler: async (ctx, { instanceId, marketplaceModuleId, approvedPermissions, approvedLocalEndpoints }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (!row?.completedAt) {
      throw new Error("Setup is not finished");
    }
    if (!row.platforms.some((platform) => platform.marketplaceModuleId === marketplaceModuleId)) {
      throw new Error(`${marketplaceModuleId} was not chosen at setup`);
    }
    await ctx.db.patch(row._id, {
      platforms: row.platforms.map((platform) =>
        platform.marketplaceModuleId === marketplaceModuleId
          ? { ...platform, approvedPermissions, approvedLocalEndpoints }
          : platform
      ),
      applyAttempts: 0,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
  },
});

/** Records that the setup wizard opened for the signed-in user. */
export const markSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const existing = await ctx.db
      .query("userSetupSeen")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      return;
    }
    await ctx.db.insert("userSetupSeen", { userId, seenAt: Date.now() });
  },
});
