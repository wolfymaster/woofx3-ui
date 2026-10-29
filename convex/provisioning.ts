import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, query } from "./_generated/server";
import {
  createEngine,
  currentRelease,
  getEngine,
  isMaintenanceConfigured,
  MAINTENANCE_OWNER_TYPE,
  normalizeSlug,
  slugAvailability,
} from "./lib/maintenanceClient";
import {
  deleteManagedEngineRow,
  type RetryKind,
  retryManagedEngineRow,
  stepsOf,
  type UpgradeRequestOutcome,
  upgradeManagedEngineRow,
  upgradesEnabled,
  userFacingError,
} from "./lib/managedEngineActions";
import { isUpgrade } from "./lib/releaseVersion";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * Managed engines: the public surface onboarding and the admin page call.
 *
 * The woofx3 maintenance API does the work; these actions decide who may ask
 * for it, keep the provisioning row in step, and never let a secret out. The
 * registration token in particular is generated here, handed to the
 * maintenance API once, and replayed to the engine at registration — no query
 * returns it.
 */

/** 32 random bytes, base64url — inside the maintenance API's `[A-Za-z0-9_-]{32,256}`. */
function generateRegistrationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of Array.from(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function releaseNotesUrl(version: string): string {
  return `https://github.com/wolfymaster/woofx3/releases/tag/${encodeURIComponent(version)}`;
}

export interface UpgradeInfo {
  /** Whether the engine can be upgraded now: it is running, and on a release other than the offered one. */
  available: boolean;
  offered: string | null;
  current: string | null;
  releaseNotesUrl: string | null;
}

export type { UpgradeRequestOutcome } from "./lib/managedEngineActions";

/** Whether this deployment can create managed engines at all. */
export const isAvailable = query({
  args: {},
  handler: async () => {
    return { available: isMaintenanceConfigured() };
  },
});

/**
 * The provisioning row for an instance, for the progress screen and the admin
 * page. Deliberately omits `registrationToken`: it is the only thing standing
 * between a public engine and whoever reaches it first.
 */
export const forInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!row) {
      return null;
    }
    const { registrationToken: _registrationToken, upgrade, ...rest } = row;
    // Who asked is not the customer's to see: an operator's upgrade shows
    // exactly as one a member started.
    return { ...rest, upgrade: upgrade ? withoutRequester(upgrade) : undefined };
  },
});

/**
 * What only the maintenance API knows about a managed engine: whether it has
 * been flagged for an operator's attention. Everything else on the admin page
 * comes from the provisioning row, which the callbacks keep current, so this
 * is fetched once when the page opens rather than subscribed to.
 */
export const engineFlag = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ at: string; reason: string } | null> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    if (!row.maintenanceEngineId) {
      return null;
    }
    const { engine } = await getEngine(row.maintenanceEngineId);
    return engine.flag;
  },
});

/**
 * Whether the engine is behind the release the maintenance API offers. Nothing
 * pushes the offered release, so this is asked when the engine page opens.
 */
export const upgradeInfo = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<UpgradeInfo> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    if (!upgradesEnabled() || !row.maintenanceEngineId) {
      return { available: false, offered: null, current: null, releaseNotesUrl: null };
    }
    const { version: offered } = await currentRelease();
    const current = row.reportedVersion ?? null;
    return {
      available: row.status === "registered" && isUpgrade(offered, current),
      offered,
      current,
      releaseNotesUrl: releaseNotesUrl(offered),
    };
  },
});

/**
 * Move the engine to the release the maintenance API offers. The caller picks
 * when, never which release.
 *
 * The engine is offline while the new release starts, and the run's callbacks
 * carry the row from here: through the upgrade, a rollback if the release does
 * not come up, and back to registered.
 *
 * A request the maintenance API declines is an outcome, not an error: the
 * reason is on the row for the engine page to show, and the engine was never
 * touched.
 */
export const upgradeManagedEngine = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ outcome: UpgradeRequestOutcome }> => {
    const { row, userId } = await requireManagedRow(ctx, instanceId);
    return upgradeManagedEngineRow(ctx, row, userId);
  },
});

/** Dismiss the outcome of the last upgrade, so the engine page stops showing it. */
export const acknowledgeUpgrade = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<null> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    await ctx.runMutation(internal.provisioningInternal.recordUpgradeAcknowledged, { provisioningId: row._id });
    return null;
  },
});

/** Live availability for the slug field: format, reserved words and whether it is taken. */
export const checkSlug = action({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<{ available: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return slugAvailability(slug);
  },
});

/**
 * Create a managed engine for an account.
 *
 * The provisioning row is written before the maintenance API is called, so its
 * id can be the idempotency key: a retried action returns the original run
 * rather than provisioning a second engine. `externalRef` carries the Convex
 * instance id, which is how callbacks find their way back to this row.
 */
export const startManagedEngine = action({
  args: { accountId: v.id("accounts"), slug: v.string() },
  handler: async (ctx, { accountId, slug }): Promise<{ instanceId: Id<"instances">; engineId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL is not configured");
    }

    const normalizedSlug = normalizeSlug(slug);
    const registrationToken = generateRegistrationToken();
    const reserved = await ctx.runMutation(internal.provisioningInternal.reserveManagedInstance, {
      accountId,
      userId,
      slug: normalizedSlug,
      registrationToken,
    });

    const twitchChannel = await ctx.runQuery(internal.users.twitchChannelForUser, { userId });

    try {
      const created = await createEngine(
        {
          slug: normalizedSlug,
          owner: { type: MAINTENANCE_OWNER_TYPE, ref: accountId },
          externalRef: reserved.instanceId,
          registrationToken,
          callbackUrl: `${siteUrl}/api/webhooks/maintenance`,
          ...(twitchChannel ? { twitchChannel } : {}),
        },
        reserved.provisioningId
      );
      await ctx.runMutation(internal.provisioningInternal.recordEngineRequested, {
        provisioningId: reserved.provisioningId,
        maintenanceEngineId: created.engine.id,
        runId: created.run.id,
        steps: stepsOf(created.run),
        publicUrl: created.engine.publicUrl ?? undefined,
      });
      return { instanceId: reserved.instanceId, engineId: created.engine.id };
    } catch (error) {
      await ctx.runMutation(internal.provisioningInternal.recordProvisioningError, {
        provisioningId: reserved.provisioningId,
        error: userFacingError(error),
      });
      throw error;
    }
  },
});

/**
 * Resume a failed run, or re-run a registration that failed after the engine
 * came up. Which one it is depends on how far the row got: an engine that
 * already published a URL does not need provisioning again, unless what failed
 * was a later redeploy, which is resumed like any other run.
 */
export const retry = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ retried: RetryKind }> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    return retryManagedEngineRow(ctx, row);
  },
});

/**
 * Tear the engine down: the maintenance API removes the route, the container,
 * the database and its role. The Convex instance row stays — it owns the
 * account's scenes, workflows and members, and deleting it is a separate,
 * deliberate act.
 */
export const deleteManagedEngine = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ deprovisioning: boolean }> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    return deleteManagedEngineRow(ctx, row);
  },
});

function withoutRequester<T extends { requestedBy?: unknown }>(upgrade: T): Omit<T, "requestedBy"> {
  const { requestedBy: _requestedBy, ...shown } = upgrade;
  return shown;
}

/** Owner or admin of the instance, and a provisioning row to act on. */
async function requireManagedRow(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<{ row: Doc<"engineProvisioning">; userId: Id<"users"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
  if (!membership || membership.role === "member") {
    throw new Error("Not authorized");
  }
  const row = await ctx.runQuery(internal.provisioningInternal.forInstanceInternal, { instanceId });
  if (!row) {
    throw new Error("This workspace has no managed engine");
  }
  return { row, userId };
}
