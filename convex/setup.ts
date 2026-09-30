import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { readMemberRole } from "./instances";
import { requireInstanceRole } from "./lib/instanceAccess";
import { type ChosenSetupPlatform, setupChoiceError } from "./lib/setupPlatforms";
import { canManageTwitchLink } from "./lib/twitchLinkPolicy";

// Bounds for reads of tables that hold a handful of rows per key.
const MAX_SETUP_PLATFORMS = 50;
const MAX_PLATFORM_LINKS = 20;

const chosenPlatformValidator = v.object({
  marketplaceModuleId: v.string(),
  approvedPermissions: v.array(v.string()),
});

export interface SetupStatus {
  platforms: ChosenSetupPlatform[];
  platformsChosenAt: number | null;
  completedAt: number | null;
  /** The instance's Twitch link, whether or not its tokens still work. */
  twitchUsername: string | null;
  /** Whether the viewer may choose platforms and connect Twitch: only an owner or admin can. */
  canManageSetup: boolean;
  /** Whether the setup wizard has opened for the viewer before. */
  setupSeen: boolean;
  /** Whether the engine has answered the registration handshake. */
  engineRegistered: boolean;
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
    const [row, twitchLink, seen, instance] = await Promise.all([
      readSetupRow(ctx, instanceId),
      readTwitchLink(ctx, instanceId),
      ctx.db
        .query("userSetupSeen")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first(),
      ctx.db.get(instanceId),
    ]);
    return {
      platforms: row?.platforms ?? [],
      platformsChosenAt: row?.platformsChosenAt ?? null,
      completedAt: row?.completedAt ?? null,
      twitchUsername: twitchLink?.platformUsername ?? null,
      canManageSetup: canManageTwitchLink(role),
      setupSeen: seen !== null,
      engineRegistered: Boolean(instance?.clientId),
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
      return;
    }
    await ctx.db.insert("instanceSetup", { instanceId, platforms, platformsChosenAt: now, updatedAt: now });
  },
});

/** Marks setup finished. Refused until platforms are chosen and Twitch is connected. */
export const complete = mutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
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
    await ctx.db.patch(row._id, { completedAt: now, updatedAt: now });
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
