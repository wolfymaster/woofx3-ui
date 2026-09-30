import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { readMemberRole } from "./instances";
import { requireInstanceRole } from "./lib/instanceAccess";
import { availableInterests, buildDashboardPreset, PRESET_LAYOUT_ID } from "./lib/setupInterests";
import { type ChosenSetupPlatform, setupChoiceError } from "./lib/setupPlatforms";
import { canManageTwitchLink } from "./lib/twitchLinkPolicy";

// Bounds for reads of tables that hold a handful of rows per key.
const MAX_SETUP_PLATFORMS = 50;
const MAX_PLATFORM_LINKS = 20;

const chosenPlatformValidator = v.object({
  marketplaceModuleId: v.string(),
  name: v.optional(v.string()),
  approvedPermissions: v.array(v.string()),
});

export type SetupModuleInstall = NonNullable<Doc<"instanceSetup">["moduleInstalls"]>[number];
export type SetupPackInstall = NonNullable<Doc<"instanceSetup">["packInstalls"]>[number];

export interface SetupStatus {
  platforms: ChosenSetupPlatform[];
  platformsChosenAt: number | null;
  /** Marketplace ids of the platforms setup cannot finish without. */
  requiredModuleIds: string[];
  interests: string[];
  interestsChosenAt: number | null;
  completedAt: number | null;
  /** The instance's Twitch link, whether or not its tokens still work. */
  twitchUsername: string | null;
  /** Whether the viewer may choose platforms and connect Twitch: only an owner or admin can. */
  canManageSetup: boolean;
  /** Whether the setup wizard has opened for the viewer before. */
  setupSeen: boolean;
  /** Whether the engine has answered the registration handshake. */
  engineRegistered: boolean;
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

/**
 * Applies the setup's choices now if the engine is registered. Otherwise
 * registration applies them (instances.applyRegistration).
 */
async function scheduleApplyIfRegistered(ctx: MutationCtx, instanceId: Id<"instances">) {
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
    const [row, twitchLink, seen, instance, curated] = await Promise.all([
      readSetupRow(ctx, instanceId),
      readTwitchLink(ctx, instanceId),
      ctx.db
        .query("userSetupSeen")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first(),
      ctx.db.get(instanceId),
      ctx.db.query("setupPlatforms").withIndex("by_sort_order").take(MAX_SETUP_PLATFORMS),
    ]);
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
      platformsChosenAt: row?.platformsChosenAt ?? null,
      requiredModuleIds: curated.filter((entry) => entry.required).map((entry) => entry.marketplaceModuleId),
      interests: row?.interests ?? [],
      interestsChosenAt: row?.interestsChosenAt ?? null,
      completedAt: row?.completedAt ?? null,
      twitchUsername: twitchLink?.platformUsername ?? null,
      canManageSetup: canManageTwitchLink(role),
      setupSeen: seen !== null,
      engineRegistered: Boolean(instance?.clientId),
      moduleInstalls: row?.moduleInstalls ?? [],
      packInstalls: row?.packInstalls ?? [],
    };
  },
});

/**
 * Saves the platforms chosen at setup and the permissions approved for each.
 * Every required platform in the curated list must be included.
 */
export const choosePlatforms = mutation({
  args: { instanceId: v.id("instances"), platforms: v.array(chosenPlatformValidator) },
  handler: async (ctx, { instanceId, platforms }) => {
    await requireInstanceRole(ctx, instanceId, "admin");

    const curated = await ctx.db.query("setupPlatforms").withIndex("by_sort_order").take(MAX_SETUP_PLATFORMS);
    const requiredIds = curated.filter((entry) => entry.required).map((entry) => entry.marketplaceModuleId);
    const error = setupChoiceError(platforms, requiredIds);
    if (error) {
      throw new Error(error);
    }

    const now = Date.now();
    const row = await readSetupRow(ctx, instanceId);
    if (row) {
      await ctx.db.patch(row._id, { platforms, platformsChosenAt: now, updatedAt: now });
      if (row.completedAt) {
        await scheduleApplyIfRegistered(ctx, instanceId);
      }
      return;
    }
    await ctx.db.insert("instanceSetup", { instanceId, platforms, platformsChosenAt: now, updatedAt: now });
  },
});

/**
 * Saves what the streamer wants woofx3 to do. Only interests offered for the
 * chosen platforms are accepted; skipping the question saves none.
 */
export const chooseInterests = mutation({
  args: { instanceId: v.id("instances"), interestIds: v.array(v.string()) },
  handler: async (ctx, { instanceId, interestIds }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (!row?.platformsChosenAt) {
      throw new Error("Choose your platforms first");
    }
    const offered = new Set(
      availableInterests(row.platforms.map((platform) => platform.marketplaceModuleId)).map((interest) => interest.id)
    );
    const unknown = interestIds.filter((id) => !offered.has(id));
    if (unknown.length > 0) {
      throw new Error(`Not offered for the chosen platforms: ${unknown.join(", ")}`);
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { interests: [...new Set(interestIds)], interestsChosenAt: now, updatedAt: now });
    if (row.completedAt) {
      await scheduleApplyIfRegistered(ctx, instanceId);
    }
  },
});

/**
 * Gives the user a first dashboard panel built from the interests, unless they
 * already have one: a dashboard they have arranged is never replaced.
 */
async function seedDashboard(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">,
  interests: readonly string[]
) {
  const existing = await ctx.db
    .query("dashboardLayouts")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  if (existing && (existing.panels ?? []).length > 0) {
    return;
  }
  const panels = [
    { id: crypto.randomUUID(), name: "Main", layoutId: PRESET_LAYOUT_ID, widgets: buildDashboardPreset(interests) },
  ];
  if (existing) {
    await ctx.db.patch(existing._id, { panels });
    return;
  }
  await ctx.db.insert("dashboardLayouts", { instanceId, userId, panels });
}

/**
 * Finishes setup: seeds the caller's dashboard, and installs the chosen
 * modules and starter packs, now if the engine is registered, otherwise when
 * it registers. Refused until platforms are chosen and Twitch is connected.
 */
export const complete = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (!row?.platformsChosenAt) {
      throw new Error("Choose your platforms before finishing setup");
    }
    if (!(await readTwitchLink(ctx, instanceId))) {
      throw new Error("Connect Twitch before finishing setup");
    }
    if (row.completedAt) {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { completedAt: now, completedByUserId: userId, updatedAt: now });
    await seedDashboard(ctx, instanceId, userId, row.interests ?? []);
    await scheduleApplyIfRegistered(ctx, instanceId);
  },
});

/** Runs the apply again, e.g. after a module install failed. */
export const retryApply = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const row = await readSetupRow(ctx, instanceId);
    if (!row?.completedAt) {
      throw new Error("Setup is not finished");
    }
    await ctx.db.patch(row._id, { applyAttempts: 0, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.setupApply.run, { instanceId });
  },
});

/**
 * Approves the permissions a chosen module's current build asks for, after
 * its install came back needing approval, and installs it again.
 */
export const approveModulePermissions = mutation({
  args: {
    instanceId: v.id("instances"),
    marketplaceModuleId: v.string(),
    approvedPermissions: v.array(v.string()),
  },
  handler: async (ctx, { instanceId, marketplaceModuleId, approvedPermissions }) => {
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
        platform.marketplaceModuleId === marketplaceModuleId ? { ...platform, approvedPermissions } : platform
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
