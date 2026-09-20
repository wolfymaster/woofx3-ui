import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, action, query } from "./_generated/server";
import {
  checkSlugAvailability,
  createEngine,
  deleteEngine,
  isMaintenanceConfigured,
  MAINTENANCE_OWNER_TYPE,
  MaintenanceApiError,
  type MaintenanceRun,
  retryRun,
} from "./lib/maintenanceClient";
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
 * Resume a failed provision, or re-run a registration that failed after the
 * engine came up. Which one it is depends on how far the row got: an engine
 * that already published a URL does not need provisioning again.
 */
export const retry = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ retried: "provisioning" | "registration" }> => {
    const row = await requireManagedRow(ctx, instanceId);
    if (row.status === "deprovisioning") {
      throw new Error("This engine is being deleted");
    }

    if (row.publicUrl) {
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
      });
      return { retried: "provisioning" };
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
    const row = await requireManagedRow(ctx, instanceId);
    if (!row.maintenanceEngineId) {
      throw new Error("This workspace has no managed engine to delete");
    }

    await deleteEngine(row.maintenanceEngineId, `${row._id}:delete`);
    await ctx.runMutation(internal.provisioningInternal.recordDeprovisionStarted, { provisioningId: row._id });
    return { deprovisioning: true };
  },
});

/** Owner or admin of the instance, and a provisioning row to act on. */
async function requireManagedRow(ctx: ActionCtx, instanceId: Id<"instances">): Promise<Doc<"engineProvisioning">> {
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
  return row;
}
