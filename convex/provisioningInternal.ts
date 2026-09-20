import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { ensureInstanceMember, mapAccountRoleToInstanceRole } from "./lib/teamAccess";
import { logger } from "./logger";
import { performRegistration } from "./registration";

/**
 * Database side of managed-engine provisioning. Everything here is internal:
 * the public surface is `convex/provisioning.ts`, and the maintenance API's
 * callbacks reach these through `POST /api/webhooks/maintenance`.
 *
 * The provisioning row is the single record of a managed engine's progress.
 * It is written from three directions — the action that starts a run, the
 * maintenance API's callbacks, and the registration handshake that follows —
 * which is why every writer here patches named fields rather than replacing
 * the row.
 */

const stepValidator = v.object({
  key: v.string(),
  label: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  error: v.optional(v.string()),
});

/**
 * Registration is attempted right after the engine reports ready. A managed
 * engine can answer `/ready` a moment before its api accepts RPC, so the first
 * attempt failing is ordinary rather than fatal — these are the waits before
 * attempts 2, 3 and 4, after which the row fails and the user retries.
 */
const REGISTRATION_RETRY_DELAYS_MS = [10_000, 30_000, 120_000];

/** Callback ids are kept only long enough to cover redelivery, which the sender stops after a day. */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const forInstanceInternal = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
  },
});

export const byMaintenanceEngine = internalQuery({
  args: { maintenanceEngineId: v.string() },
  handler: async (ctx, { maintenanceEngineId }) => {
    return ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", maintenanceEngineId))
      .first();
  },
});

/**
 * The instance a managed engine will belong to, plus a fresh provisioning row.
 *
 * Retrying onboarding must not leave a trail of half-made instances, so an
 * account's managed instance that never finished registering is reused rather
 * than joined by a second one. A run that is still in flight is refused
 * instead: its engine exists in the maintenance API, and starting another
 * would strand it.
 */
export const reserveManagedInstance = internalMutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.id("users"),
    slug: v.string(),
    registrationToken: v.string(),
  },
  handler: async (ctx, { accountId, userId, slug, registrationToken }) => {
    // The account owner only: an engine is a resource the account is billed
    // for, which is a narrower question than who may manage its team.
    const account = await ctx.db.get(accountId);
    if (!account || account.ownerId !== userId) {
      throw new Error("Not authorized");
    }

    const instanceId = await findOrCreateManagedInstance(ctx, account, userId);
    const existing = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const now = Date.now();
    if (existing) {
      const inFlight =
        existing.maintenanceEngineId !== undefined &&
        existing.status !== "failed" &&
        existing.status !== "deleted" &&
        existing.status !== "registered";
      if (inFlight) {
        throw new Error("An engine is already being created for this workspace");
      }
      if (existing.status === "registered") {
        throw new Error("This workspace already has a managed engine");
      }
      await ctx.db.patch(existing._id, {
        slug,
        status: "requested",
        steps: [],
        registrationToken,
        registrationAttempts: 0,
        maintenanceEngineId: undefined,
        runId: undefined,
        publicUrl: undefined,
        error: undefined,
        updatedAt: now,
      });
      return { instanceId, provisioningId: existing._id };
    }

    const provisioningId = await ctx.db.insert("engineProvisioning", {
      instanceId,
      accountId,
      requestedBy: userId,
      slug,
      status: "requested",
      steps: [],
      registrationToken,
      registrationAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { instanceId, provisioningId };
  },
});

async function findOrCreateManagedInstance(
  ctx: MutationCtx,
  account: Doc<"accounts">,
  userId: Id<"users">
): Promise<Id<"instances">> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .take(50);
  const reusable = instances.find((instance) => instance.hosting === "managed" && !instance.clientId);
  if (reusable) {
    return reusable._id;
  }

  // A managed engine has no URL until the maintenance API publishes one, so
  // the row starts with an empty one and `engine.ready` fills it in.
  const instanceId = await ctx.db.insert("instances", {
    accountId: account._id,
    name: account.name,
    url: "",
    hosting: "managed",
    createdAt: Date.now(),
  });
  await ensureInstanceMember(ctx, instanceId, userId, "owner");

  const teammates = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  for (const teammate of teammates) {
    if (teammate.userId === userId) {
      continue;
    }
    await ensureInstanceMember(ctx, instanceId, teammate.userId, mapAccountRoleToInstanceRole(teammate.role));
  }
  return instanceId;
}

/** The engine the maintenance API created, and the run whose steps the progress screen follows. */
export const recordEngineRequested = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    maintenanceEngineId: v.string(),
    runId: v.string(),
    steps: v.array(stepValidator),
    publicUrl: v.optional(v.string()),
  },
  handler: async (ctx, { provisioningId, maintenanceEngineId, runId, steps, publicUrl }) => {
    await ctx.db.patch(provisioningId, {
      maintenanceEngineId,
      runId,
      steps,
      status: "provisioning",
      publicUrl,
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const recordProvisioningError = internalMutation({
  args: { provisioningId: v.id("engineProvisioning"), error: v.string() },
  handler: async (ctx, { provisioningId, error }) => {
    await ctx.db.patch(provisioningId, { status: "failed", error, updatedAt: Date.now() });
  },
});

/** A retry accepted by the maintenance API: the same engine, a run resumed from its failed step. */
export const recordRetryStarted = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    runId: v.string(),
    steps: v.array(stepValidator),
  },
  handler: async (ctx, { provisioningId, runId, steps }) => {
    await ctx.db.patch(provisioningId, {
      runId,
      steps,
      status: "provisioning",
      error: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const recordDeprovisionStarted = internalMutation({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }) => {
    await ctx.db.patch(provisioningId, { status: "deprovisioning", error: undefined, updatedAt: Date.now() });
  },
});

/**
 * Records a callback id, answering whether it is new. Delivery is at-least-once,
 * so a repeat must be acknowledged without being applied a second time.
 */
export const claimCallbackEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    maintenanceEngineId: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, eventType, maintenanceEngineId }): Promise<boolean> => {
    const seen = await ctx.db
      .query("maintenanceEvents")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();
    if (seen) {
      return false;
    }
    await ctx.db.insert("maintenanceEvents", {
      eventId,
      eventType,
      maintenanceEngineId,
      receivedAt: Date.now(),
    });
    return true;
  },
});

export const cleanupOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    const stale = await ctx.db
      .query("maintenanceEvents")
      .withIndex("by_received_at", (q) => q.lt("receivedAt", cutoff))
      .take(500);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { deleted: stale.length };
  },
});

/**
 * One step of the provisioning run changed state.
 *
 * Steps arrive in run order and each may be reported several times (running,
 * then succeeded), so a known key is updated in place and an unknown one is
 * appended — which also means the list needs no seeding from the run's plan.
 */
export const applyRunStep = internalMutation({
  args: {
    maintenanceEngineId: v.string(),
    step: v.string(),
    label: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { maintenanceEngineId, step, label, status, error }) => {
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", maintenanceEngineId))
      .first();
    if (!row) {
      logger.warn("maintenance webhook: step for an unknown engine", { maintenanceEngineId, step });
      return;
    }

    const steps = [...row.steps];
    const index = steps.findIndex((existing) => existing.key === step);
    const next = { key: step, label, status, error };
    if (index === -1) {
      steps.push(next);
    } else {
      steps[index] = next;
    }

    // The first step report is what turns a requested engine into one that is
    // visibly being built. Every other status stands: a late report must not
    // pull an engine that is already registering, registered or deleted back
    // into provisioning.
    const rowStatus = row.status === "requested" ? "provisioning" : row.status;
    await ctx.db.patch(row._id, { steps, status: rowStatus, updatedAt: Date.now() });
  },
});

/**
 * The engine is serving on its public URL. This is where a managed instance
 * gets its URL, and where registration starts: the engine requires the
 * registration token this row generated, so nobody else can claim it.
 */
export const applyEngineReady = internalMutation({
  args: { maintenanceEngineId: v.string(), url: v.string() },
  handler: async (ctx, { maintenanceEngineId, url }) => {
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", maintenanceEngineId))
      .first();
    if (!row) {
      logger.warn("maintenance webhook: ready for an unknown engine", { maintenanceEngineId });
      return;
    }
    if (row.status === "registered") {
      return;
    }

    await ctx.db.patch(row.instanceId, { url });
    await ctx.db.patch(row._id, {
      publicUrl: url,
      status: "registering",
      registrationAttempts: 0,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.provisioningInternal.runRegistration, { provisioningId: row._id });
  },
});

export const applyEngineFailed = internalMutation({
  args: { maintenanceEngineId: v.string(), step: v.string(), error: v.string() },
  handler: async (ctx, { maintenanceEngineId, step, error }) => {
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", maintenanceEngineId))
      .first();
    if (!row) {
      logger.warn("maintenance webhook: failure for an unknown engine", { maintenanceEngineId, step });
      return;
    }
    await ctx.db.patch(row._id, { status: "failed", error: `${step}: ${error}`, updatedAt: Date.now() });
  },
});

export const applyEngineDeleted = internalMutation({
  args: { maintenanceEngineId: v.string() },
  handler: async (ctx, { maintenanceEngineId }) => {
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", maintenanceEngineId))
      .first();
    if (!row) {
      return;
    }
    // The instance row stays: it still owns the account's scenes, workflows and
    // members. Deleting it is the account owner's decision, on the admin page.
    await ctx.db.patch(row._id, { status: "deleted", updatedAt: Date.now() });
  },
});

/**
 * Runs the engine handshake for a managed engine and records the outcome.
 *
 * Scheduled rather than called inline so a slow or unreachable engine cannot
 * hold the webhook request open, and so each retry is its own transaction.
 */
export const runRegistration = internalAction({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }): Promise<void> => {
    const row = await ctx.runQuery(internal.provisioningInternal.getProvisioning, { provisioningId });
    if (!row || row.status !== "registering") {
      return;
    }

    const result = await performRegistration(ctx, {
      instanceId: row.instanceId,
      userId: row.requestedBy,
      registrationToken: row.registrationToken,
    });

    await ctx.runMutation(internal.provisioningInternal.recordRegistrationResult, {
      provisioningId,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
  },
});

export const getProvisioning = internalQuery({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }) => {
    return ctx.db.get(provisioningId);
  },
});

export const recordRegistrationResult = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { provisioningId, ok, error }) => {
    const row = await ctx.db.get(provisioningId);
    if (!row) {
      return;
    }
    if (ok) {
      await ctx.db.patch(provisioningId, { status: "registered", error: undefined, updatedAt: Date.now() });
      return;
    }

    const attempts = (row.registrationAttempts ?? 0) + 1;
    const delay = REGISTRATION_RETRY_DELAYS_MS[attempts - 1];
    if (delay === undefined) {
      await ctx.db.patch(provisioningId, {
        status: "failed",
        error: `registration: ${error ?? "unknown error"}`,
        registrationAttempts: attempts,
        updatedAt: Date.now(),
      });
      return;
    }

    await ctx.db.patch(provisioningId, { registrationAttempts: attempts, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(delay, internal.provisioningInternal.runRegistration, { provisioningId });
  },
});

/** Re-runs the handshake for an engine that provisioned but failed to register. */
export const restartRegistration = internalMutation({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }) => {
    await ctx.db.patch(provisioningId, {
      status: "registering",
      registrationAttempts: 0,
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.provisioningInternal.runRegistration, { provisioningId });
  },
});
