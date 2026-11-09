import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { scheduleEngineStopRetry } from "./billing";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { switchedStatus } from "./lib/engineSwitch";
import { requireUsableSubscription } from "./lib/entitlementAccess";
import { REQUEST_IN_FLIGHT_MS } from "./lib/firstRun";
import {
  decideRedeployEvent,
  mergeRunSnapshot,
  mergeStep,
  type RedeployEvent,
  redeployRunFailed,
} from "./lib/maintenanceUpgrade";
import { applyTransition, subscriptionFor } from "./lib/subscriptions";
import { grantNewEngineMembers } from "./lib/teamAccess";
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

type ProvisioningStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

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
  detail: v.optional(v.string()),
});

// Bounds the read of an instance's platform links, a handful per instance.
const MAX_PLATFORM_LINKS = 20;

/**
 * Registration is attempted right after the engine reports ready. A managed
 * engine can answer `/ready` a moment before its api accepts RPC, so the first
 * attempt failing is ordinary rather than fatal — these are the waits before
 * attempts 2, 3 and 4, after which the row fails and the user retries.
 */
const REGISTRATION_RETRY_DELAYS_MS = [10_000, 30_000, 120_000];

/**
 * How long an upgrade may go without a run before it is written off. Longer
 * than an action can run, so by then the action that was to ask for the run is
 * certainly over; had its request arrived, the run's first report would have
 * given the row its id long before.
 */
const UPGRADE_REQUEST_DEADLINE_MS = 15 * 60 * 1000;

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
    // Used unless the row has a request still open, whose values must not change.
    newRegistrationToken: v.string(),
    newCreateRequestId: v.string(),
  },
  handler: async (ctx, { accountId, userId, slug, newRegistrationToken, newCreateRequestId }) => {
    // The account owner only: an engine is a resource the account is billed
    // for, which is a narrower question than who may manage its team.
    const account = await ctx.db.get(accountId);
    if (!account || account.ownerId !== userId) {
      throw new Error("Not authorized");
    }

    const { instanceId } = await findOrCreateManagedInstance(ctx, account);
    await startTrialIfNew(ctx, accountId, Date.now());
    // Every managed request (onboarding, the username form, retry) comes
    // through here, so a suspended org can't build an engine nothing would stop.
    await requireUsableSubscription(ctx, accountId);
    const existing = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const setup = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (setup?.usernameNeededAt !== undefined) {
      await ctx.db.patch(setup._id, { usernameNeededAt: undefined });
    }

    const now = Date.now();
    if (existing) {
      const inFlight =
        existing.maintenanceEngineId !== undefined &&
        existing.status !== "failed" &&
        existing.status !== "deleted" &&
        existing.status !== "registered";
      const beingRequested = existing.status === "requested" && now - existing.updatedAt < REQUEST_IN_FLIGHT_MS;
      if (inFlight || beingRequested) {
        throw new Error("An engine is already being created for this workspace");
      }
      if (existing.status === "registered") {
        throw new Error("This workspace already has a managed engine");
      }
      await deleteHeldSlugs(ctx, instanceId);
      const open = requestStillOpen(existing);
      const registrationToken = open ? existing.registrationToken : newRegistrationToken;
      const createRequestId = open ? (existing.createRequestId as string) : newCreateRequestId;
      await ctx.db.patch(existing._id, {
        slug,
        status: "requested",
        steps: [],
        registrationToken,
        createRequestId,
        registrationAttempts: 0,
        maintenanceEngineId: undefined,
        runId: undefined,
        publicUrl: undefined,
        error: undefined,
        upgrade: undefined,
        updatedAt: now,
      });
      return { instanceId, provisioningId: existing._id, registrationToken, createRequestId };
    }

    const provisioningId = await ctx.db.insert("engineProvisioning", {
      instanceId,
      accountId,
      requestedBy: userId,
      slug,
      status: "requested",
      steps: [],
      registrationToken: newRegistrationToken,
      createRequestId: newCreateRequestId,
      registrationAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { instanceId, provisioningId, registrationToken: newRegistrationToken, createRequestId: newCreateRequestId };
  },
});

/** A create request no answer has closed: the maintenance API may hold an engine for it. */
function requestStillOpen(row: Doc<"engineProvisioning">): boolean {
  return row.createRequestId !== undefined && row.maintenanceEngineId === undefined && row.status !== "deleted";
}

/** An engine's old names die with it: the maintenance API can then issue them to anyone. */
async function deleteHeldSlugs(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const held = await ctx.db
    .query("engineHeldSlugs")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();
  for (const row of held) {
    await ctx.db.delete(row._id);
  }
}

/**
 * Throws `subscription_suspended` unless the org's subscription is usable, for
 * actions that resume a managed engine's run outside `reserveManagedInstance`.
 * An org with no subscription row yet predates subscriptions and is not
 * suspended, so it passes until the subscription migration gives it one.
 */
export const assertCanResumeEngine = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<null> => {
    if ((await subscriptionFor(ctx, accountId)) !== null) {
      await requireUsableSubscription(ctx, accountId);
    }
    return null;
  },
});

/**
 * An org's first managed engine starts its Starter trial. An org that already
 * has a subscription row, in any state, gets no second one.
 */
export async function startTrialIfNew(ctx: MutationCtx, accountId: Id<"accounts">, now: number): Promise<void> {
  if ((await subscriptionFor(ctx, accountId)) !== null) {
    return;
  }
  const result = await applyTransition(ctx, {
    accountId,
    event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
    now,
    actor: "signup",
    origin: "signup",
  });
  if (!result.ok) {
    throw new Error(`startTrialIfNew: ${result.error.event} is illegal from ${result.error.from}`);
  }
}

export async function findOrCreateManagedInstance(
  ctx: MutationCtx,
  account: Doc<"accounts">
): Promise<{ instanceId: Id<"instances">; created: boolean }> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .take(50);
  const reusable = instances.find((instance) => instance.hosting === "managed" && !instance.clientId);
  if (reusable) {
    return { instanceId: reusable._id, created: false };
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
  await grantNewEngineMembers(ctx, instanceId);
  return { instanceId, created: true };
}

/**
 * Records that a brand new instance is on its first run, which is what lets
 * applying seed it (`seedsDefaults`). An instance with a setup row keeps what
 * the row says: a marker is never added to one that was not made this way.
 */
export async function markFirstRun(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const setup = await ctx.db
    .query("instanceSetup")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (setup) {
    return;
  }
  const now = Date.now();
  await ctx.db.insert("instanceSetup", { instanceId, platforms: [], firstRunAt: now, updatedAt: now });
}

/** What a first engine is derived from: whose it is, and the Twitch login that names it. */
export const firstEngineFacts = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const instance = await ctx.db.get(instanceId);
    const account = instance ? await ctx.db.get(instance.accountId) : null;
    if (!account) {
      throw new Error(`Instance ${instanceId} has no account`);
    }
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(MAX_PLATFORM_LINKS);
    const login = links.find((link) => link.platform === "twitch")?.platformLogin ?? null;
    const provisioning = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    const unsettledSlug = provisioning && requestStillOpen(provisioning) ? provisioning.slug : null;
    return { accountId: account._id, ownerId: account.ownerId, login, unsettledSlug };
  },
});

/** Sends the connect screen to asking for a username, none of the derived ones being usable. */
export const markUsernameNeeded = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const setup = await ctx.db
      .query("instanceSetup")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!setup) {
      throw new Error(`Instance ${instanceId} has no setup to ask a username for`);
    }
    const now = Date.now();
    await ctx.db.patch(setup._id, { usernameNeededAt: now, updatedAt: now });
  },
});

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
    const row = await ctx.db.get(provisioningId);
    // The run's callbacks can get here first and have moved the row on.
    if (row?.maintenanceEngineId === maintenanceEngineId) {
      await ctx.db.patch(provisioningId, {
        runId,
        steps: mergeRunSnapshot(row.steps, steps),
        publicUrl: row.publicUrl ?? publicUrl,
      });
      return;
    }
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

/** The maintenance API accepted a rename. Repeating it after a lost response changes nothing. */
export const recordEngineRenamed = internalMutation({
  args: { provisioningId: v.id("engineProvisioning"), slug: v.string() },
  handler: async (ctx, { provisioningId, slug }) => {
    const row = await ctx.db.get(provisioningId);
    if (!row) {
      throw new Error("A rename was recorded for a row that no longer exists");
    }
    if (row.slug === slug) {
      return;
    }
    const held = await ctx.db
      .query("engineHeldSlugs")
      .withIndex("by_instance", (q) => q.eq("instanceId", row.instanceId))
      .collect();
    const takenBack = held.find((candidate) => candidate.slug === slug);
    if (takenBack) {
      await ctx.db.delete(takenBack._id);
    }
    await ctx.db.insert("engineHeldSlugs", { slug: row.slug, instanceId: row.instanceId });
    await ctx.db.patch(provisioningId, { slug, updatedAt: Date.now() });
  },
});

export const recordProvisioningError = internalMutation({
  args: { provisioningId: v.id("engineProvisioning"), error: v.string(), requestSettled: v.boolean() },
  handler: async (ctx, { provisioningId, error, requestSettled }) => {
    await ctx.db.patch(provisioningId, {
      status: "failed",
      error,
      updatedAt: Date.now(),
      ...(requestSettled ? { createRequestId: undefined } : {}),
    });
  },
});

/**
 * A retry accepted by the maintenance API: the same engine, a run resumed from
 * its failed step. A resumed redeploy puts the row back to upgrading, since its
 * engine is already built and registered.
 */
export const recordRetryStarted = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    runId: v.string(),
    steps: v.array(stepValidator),
    redeploy: v.boolean(),
  },
  handler: async (ctx, { provisioningId, runId, steps, redeploy }) => {
    if (!redeploy) {
      await ctx.db.patch(provisioningId, {
        runId,
        steps,
        status: "provisioning",
        error: undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    const row = await ctx.db.get(provisioningId);
    if (!row?.upgrade) {
      throw new Error("A redeploy was retried on a row with no upgrade");
    }
    const { outcome: _outcome, error: _error, ...inProgress } = row.upgrade;
    await ctx.db.patch(provisioningId, {
      runId,
      steps,
      status: "upgrading",
      error: undefined,
      upgrade: inProgress,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Marks a registered engine as upgrading, before the maintenance API is asked
 * to upgrade it. Written first so that whatever the run reports, however soon,
 * finds a row that expects it, and so a second request for the same engine
 * sees the first instead of racing it.
 */
export const beginUpgrade = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    requestedBy: v.union(v.id("users"), v.object({ operator: v.string() })),
    fromVersion: v.string(),
    toVersion: v.string(),
  },
  handler: async (
    ctx,
    { provisioningId, requestedBy, fromVersion, toVersion }
  ): Promise<{ begun: true; attempt: number } | { begun: false; status: Doc<"engineProvisioning">["status"] }> => {
    const row = await ctx.db.get(provisioningId);
    if (!row) {
      throw new Error("This workspace has no managed engine");
    }
    if (row.status !== "registered") {
      return { begun: false, status: row.status };
    }

    const now = Date.now();
    const attempt = (row.upgrade?.attempt ?? 0) + 1;
    await ctx.db.patch(provisioningId, {
      status: "upgrading",
      runId: undefined,
      steps: [],
      error: undefined,
      upgrade: { fromVersion, toVersion, requestedBy, startedAt: now, attempt, rollingBack: false },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(UPGRADE_REQUEST_DEADLINE_MS, internal.provisioningInternal.recordUpgradeNotStarted, {
      provisioningId,
      attempt,
      alreadyCurrent: false,
      error: "The upgrade request was never answered.",
    });
    return { begun: true, attempt };
  },
});

/** The run the maintenance API started for an upgrade, and its steps. */
export const recordUpgradeRun = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    runId: v.string(),
    steps: v.array(stepValidator),
  },
  handler: async (ctx, { provisioningId, runId, steps }) => {
    const row = await ctx.db.get(provisioningId);
    // The run may already be over, or have handed the row to its rollback, by
    // the time its listing gets here; either way the row has moved on.
    if (!row || row.status !== "upgrading" || (row.runId !== undefined && row.runId !== runId)) {
      return;
    }
    await ctx.db.patch(provisioningId, {
      runId,
      steps: mergeRunSnapshot(row.steps, steps),
      updatedAt: Date.now(),
    });
  },
});

/**
 * An upgrade that no run was started for: the engine was never touched, so the
 * row goes back to registered. Does nothing once a run is known, which is what
 * makes it safe to schedule as a deadline when the upgrade begins.
 */
export const recordUpgradeNotStarted = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    attempt: v.number(),
    // The engine already runs the offered release, which is not a failure.
    alreadyCurrent: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { provisioningId, attempt, alreadyCurrent, error }) => {
    const row = await ctx.db.get(provisioningId);
    if (!row?.upgrade || row.status !== "upgrading" || row.upgrade.attempt !== attempt || row.runId !== undefined) {
      return;
    }
    if (alreadyCurrent) {
      await ctx.db.patch(provisioningId, {
        status: "registered",
        reportedVersion: row.upgrade.toVersion,
        upgrade: { ...row.upgrade, acknowledged: true },
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(provisioningId, {
      status: "registered",
      upgrade: { ...row.upgrade, outcome: "failed", error: error ?? "The upgrade could not be started." },
      updatedAt: Date.now(),
    });
  },
});

export const recordUpgradeAcknowledged = internalMutation({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }) => {
    const row = await ctx.db.get(provisioningId);
    if (!row?.upgrade || row.upgrade.acknowledged) {
      return;
    }
    await ctx.db.patch(provisioningId, { upgrade: { ...row.upgrade, acknowledged: true } });
  },
});

export const recordDeprovisionStarted = internalMutation({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }) => {
    await ctx.db.patch(provisioningId, { status: "deprovisioning", error: undefined, updatedAt: Date.now() });
  },
});

/**
 * Applies one maintenance-API callback.
 *
 * One mutation for every event type, rather than one per type, because the
 * dedupe record and the change it guards have to commit together: recording
 * the id first would swallow the redelivery of an event whose effect then
 * failed to apply.
 *
 * An event about an engine this deployment does not know is acknowledged
 * rather than refused — a rejection would only make the sender retry forever.
 */
export const applyCallbackEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    maintenanceEngineId: v.string(),
    externalRef: v.optional(v.string()),
    step: v.optional(v.string()),
    label: v.optional(v.string()),
    stepStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped")
      )
    ),
    url: v.optional(v.string()),
    version: v.optional(v.string()),
    runKind: v.optional(
      v.union(
        v.literal("provision"),
        v.literal("deprovision"),
        v.literal("redeploy"),
        v.literal("stop"),
        v.literal("start")
      )
    ),
    error: v.optional(v.string()),
    runId: v.optional(v.string()),
    // Why a running step is still waiting.
    detail: v.optional(v.string()),
    // On `engine.failed`: the engine's status after the failure, and the run
    // restoring the previous release when one was queued.
    engineStatus: v.optional(v.string()),
    rollbackRunId: v.optional(v.string()),
    // On a redeploy's `engine.run.step`: the release it moves the engine to,
    // and the failed upgrade it undoes when it is a rollback.
    targetVersion: v.optional(v.string()),
    rollbackOf: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ handled: boolean; duplicate: boolean }> => {
    const seen = await ctx.db
      .query("maintenanceEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seen) {
      return { handled: true, duplicate: true };
    }
    await ctx.db.insert("maintenanceEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      maintenanceEngineId: args.maintenanceEngineId,
      receivedAt: Date.now(),
    });

    const known = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (q) => q.eq("maintenanceEngineId", args.maintenanceEngineId))
      .first();
    const row = known ?? (await adoptEngineOfOpenRequest(ctx, args));
    if (!row) {
      logger.warn("maintenance webhook: event for an unknown engine", {
        maintenanceEngineId: args.maintenanceEngineId,
        type: args.eventType,
      });
      return { handled: false, duplicate: false };
    }

    switch (args.eventType) {
      case "engine.run.step": {
        if (!args.step || !args.stepStatus) {
          return { handled: false, duplicate: false };
        }
        const step = {
          key: args.step,
          label: args.label ?? args.step,
          status: args.stepStatus,
          error: args.error,
          detail: args.detail,
        };
        if (args.runKind === "stop") {
          // A stop has nothing to show while it runs; engine.stopped settles it.
          return { handled: true, duplicate: false };
        }
        if (args.runKind === "redeploy") {
          await applyRedeployEvent(ctx, row, {
            type: "engine.run.step",
            runId: args.runId,
            step,
            targetVersion: args.targetVersion,
            rollbackOf: args.rollbackOf,
            receivedAt: Date.now(),
          });
        } else {
          await applyRunStep(ctx, row, step);
        }
        return { handled: true, duplicate: false };
      }

      case "engine.ready": {
        // An engine that is already registered comes back from an upgrade with
        // its database and its registration intact, so it is not registered
        // again: only the release it reports can have changed.
        if (row.status === "upgrading" || row.status === "registered" || redeployRunFailed(row)) {
          if (!args.version) {
            return { handled: false, duplicate: false };
          }
          await applyRedeployEvent(ctx, row, { type: "engine.ready", version: args.version });
          return { handled: true, duplicate: false };
        }
        if (!args.url) {
          return { handled: false, duplicate: false };
        }
        await applyEngineReady(ctx, row, args.url, args.version);
        return { handled: true, duplicate: false };
      }

      case "engine.failed": {
        const step = args.step ?? "unknown";
        if (args.runKind === "redeploy") {
          await applyRedeployEvent(ctx, row, {
            type: "engine.failed",
            runId: args.runId,
            step,
            error: args.error,
            engineStatus: args.engineStatus,
            rollbackRunId: args.rollbackRunId,
          });
          return { handled: true, duplicate: false };
        }
        // A failed teardown leaves the engine deprovisioning until a retry
        // finishes, so the row says so too: presenting it as an engine that
        // failed to be built would offer the user the opposite repair. A
        // failed stop or start is `failed`, which provisioning.retry resumes.
        const status = args.runKind === "deprovision" ? "deprovisioning" : "failed";
        const error = `${step}: ${args.error ?? "the maintenance API reported a failure"}`;
        await ctx.db.patch(row._id, { status, error, updatedAt: Date.now() });
        if (args.runKind === "stop") {
          // A suspended org's engine must stop; provisioning.retry is refused while suspended.
          await scheduleEngineStopRetry(ctx, { ...row, status, error }, Math.random());
        }
        return { handled: true, duplicate: false };
      }

      // stylegate:ignore ANY-ABS-002 reason="Follows applyCallbackEvent's existing switch over maintenance event types; moving every case to a handler table is its own refactor"
      case "engine.stopped":
      case "engine.started": {
        const move = args.eventType === "engine.stopped" ? "stopped" : "started";
        const status = switchedStatus(row.status, move);
        if (status === null) {
          logger.warn("maintenance webhook: engine switch doesn't apply", { status: row.status, move });
          return { handled: false, duplicate: false };
        }
        await ctx.db.patch(row._id, {
          status,
          error: undefined,
          stopRetries: undefined,
          ...(move === "started" && args.version ? { reportedVersion: args.version } : {}),
          updatedAt: Date.now(),
        });
        return { handled: true, duplicate: false };
      }

      case "engine.deleted": {
        // The instance row stays: it still owns the account's scenes, workflows
        // and members. Removing it is the account owner's decision.
        await deleteHeldSlugs(ctx, row.instanceId);
        await ctx.db.patch(row._id, { status: "deleted", error: undefined, updatedAt: Date.now() });
        return { handled: true, duplicate: false };
      }

      default: {
        return { handled: false, duplicate: false };
      }
    }
  },
});

/**
 * The row a provisioning event belongs to when its create response was lost, or
 * has not arrived yet. Dropping these would leave the row behind a run that has
 * moved on. A teardown or redeploy is never the open request's engine.
 */
async function adoptEngineOfOpenRequest(
  ctx: MutationCtx,
  args: { eventType: string; maintenanceEngineId: string; externalRef?: string; runKind?: string }
): Promise<Doc<"engineProvisioning"> | null> {
  const instanceId = args.externalRef ? ctx.db.normalizeId("instances", args.externalRef) : null;
  if (!instanceId || args.eventType === "engine.deleted" || (args.runKind && args.runKind !== "provision")) {
    return null;
  }
  const row = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (!row || !requestStillOpen(row)) {
    return null;
  }
  await ctx.db.patch(row._id, {
    maintenanceEngineId: args.maintenanceEngineId,
    status: "provisioning",
    error: undefined,
    updatedAt: Date.now(),
  });
  return ctx.db.get(row._id);
}

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
async function applyRunStep(
  ctx: MutationCtx,
  row: Doc<"engineProvisioning">,
  step: { key: string; label: string; status: ProvisioningStepStatus; error?: string; detail?: string }
): Promise<void> {
  const steps = mergeStep(row.steps, step);

  // The first step report is what turns a requested engine into one that is
  // visibly being built. Every other status stands: a late report must not
  // pull an engine that is already registering, registered or deleted back
  // into provisioning.
  const status = row.status === "requested" ? "provisioning" : row.status;
  await ctx.db.patch(row._id, { steps, status, updatedAt: Date.now() });
}

/** A report from a redeploy run: an upgrade, or the rollback of one. */
async function applyRedeployEvent(ctx: MutationCtx, row: Doc<"engineProvisioning">, event: RedeployEvent) {
  const patch = decideRedeployEvent(row, event);
  if (patch) {
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  }
}

/**
 * A newly built engine is serving on its public URL. This is where a managed
 * instance gets its URL, and where registration starts: the engine requires
 * the registration token this row generated, so nobody else can claim it.
 */
async function applyEngineReady(
  ctx: MutationCtx,
  row: Doc<"engineProvisioning">,
  url: string,
  version: string | undefined
): Promise<void> {
  await ctx.db.patch(row.instanceId, { url });
  await ctx.db.patch(row._id, {
    publicUrl: url,
    reportedVersion: version,
    status: "registering",
    registrationAttempts: 0,
    error: undefined,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.provisioningInternal.runRegistration, { provisioningId: row._id });
}

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
