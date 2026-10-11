import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, query } from "./_generated/server";
import {
  checkSlugAvailability,
  createEngine,
  currentRelease,
  deleteEngine,
  getEngine,
  isMaintenanceConfigured,
  MAINTENANCE_OWNER_TYPE,
  MaintenanceApiError,
  type MaintenanceRun,
  redeployEngine,
  redeployRefusal,
  retryRun,
} from "./lib/maintenanceClient";
import { redeployRunFailed } from "./lib/maintenanceUpgrade";
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

function stepsOf(run: MaintenanceRun) {
  return (run.steps ?? []).map((step) => ({
    key: step.key,
    label: step.label,
    status: step.status,
    error: step.error ? `${step.error.code}: ${step.error.message}` : undefined,
  }));
}

/** The message a user should see when a maintenance call fails. */
function userFacingError(error: unknown): string {
  if (error instanceof MaintenanceApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether engine owners are offered upgrades. Off until the engine releases on
 * offer are known to survive a rollback, since a failed upgrade restores the
 * previous release onto a database the new one has already migrated.
 */
function upgradesEnabled(): boolean {
  return process.env.ENGINE_UPGRADES_ENABLED === "true" && isMaintenanceConfigured();
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

export type UpgradeRequestOutcome = "started" | "already_running" | "already_current" | "not_started";

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
    const { registrationToken: _registrationToken, ...rest } = row;
    return rest;
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
    if (!upgradesEnabled()) {
      throw new Error("Engine upgrades are not available");
    }
    if (row.status === "upgrading") {
      return { outcome: "already_running" };
    }
    if (row.status !== "registered" || !row.maintenanceEngineId) {
      throw new Error("Only a running engine can be upgraded");
    }

    const engineId = row.maintenanceEngineId;
    const { version: toVersion } = await currentRelease();
    const fromVersion = row.reportedVersion ?? (await getEngine(engineId)).engine.image?.version;
    if (!fromVersion) {
      throw new Error("The engine's current release is unknown");
    }
    // The owner chooses when, never what, and never a step backwards from a
    // release an operator put the engine on.
    if (!isUpgrade(toVersion, fromVersion)) {
      return { outcome: "already_current" };
    }

    const begun = await ctx.runMutation(internal.provisioningInternal.beginUpgrade, {
      provisioningId: row._id,
      requestedBy: userId,
      fromVersion,
      toVersion,
    });
    if (!begun.begun) {
      if (begun.status === "upgrading") {
        return { outcome: "already_running" };
      }
      throw new Error("Only a running engine can be upgraded");
    }

    let run: MaintenanceRun;
    try {
      ({ run } = await redeployEngine(engineId, `${row._id}:upgrade:${toVersion}:${begun.attempt}`));
    } catch (error) {
      const refusal = redeployRefusal(error);
      const alreadyCurrent = refusal === "already_current";
      await ctx.runMutation(internal.provisioningInternal.recordUpgradeNotStarted, {
        provisioningId: row._id,
        attempt: begun.attempt,
        alreadyCurrent,
        error:
          refusal === "run_in_progress"
            ? "Another operation is already running on this engine."
            : userFacingError(error),
      });
      return { outcome: alreadyCurrent ? "already_current" : "not_started" };
    }
    await ctx.runMutation(internal.provisioningInternal.recordUpgradeRun, {
      provisioningId: row._id,
      runId: run.id,
      steps: stepsOf(run),
    });
    return { outcome: "started" };
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
    try {
      return await checkSlugAvailability(slug.trim().toLowerCase());
    } catch (error) {
      if (error instanceof MaintenanceApiError && error.status === 400) {
        return { available: false, reason: error.message };
      }
      throw error;
    }
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

    const normalizedSlug = slug.trim().toLowerCase();
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
  handler: async (ctx, { instanceId }): Promise<{ retried: "provisioning" | "registration" | "upgrade" }> => {
    const { row } = await requireManagedRow(ctx, instanceId);
    if (row.status === "deprovisioning") {
      throw new Error("This engine is being deleted");
    }

    const redeploy = redeployRunFailed(row);
    if (row.publicUrl && !redeploy) {
      await ctx.runMutation(internal.provisioningInternal.restartRegistration, { provisioningId: row._id });
      return { retried: "registration" };
    }
    if (!row.maintenanceEngineId || !row.runId) {
      throw new Error("This engine was never created — start it again instead");
    }

    try {
      // A resumed run keeps its id, so the key carries the row's last change
      // too: two clicks on one failure are the same request, but a second
      // failure of the same run can be retried again rather than answered from
      // the maintenance API's stored response.
      const idempotencyKey = `${row._id}:retry:${row.runId}:${row.updatedAt}`;
      const { run } = await retryRun(row.maintenanceEngineId, row.runId, idempotencyKey);
      await ctx.runMutation(internal.provisioningInternal.recordRetryStarted, {
        provisioningId: row._id,
        runId: run.id,
        steps: stepsOf(run),
        redeploy,
      });
      return { retried: redeploy ? "upgrade" : "provisioning" };
    } catch (error) {
      await ctx.runMutation(internal.provisioningInternal.recordProvisioningError, {
        provisioningId: row._id,
        error: userFacingError(error),
      });
      throw error;
    }
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
    if (!row.maintenanceEngineId) {
      throw new Error("This workspace has no managed engine to delete");
    }

    await deleteEngine(row.maintenanceEngineId, `${row._id}:delete`);
    await ctx.runMutation(internal.provisioningInternal.recordDeprovisionStarted, { provisioningId: row._id });
    return { deprovisioning: true };
  },
});

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
