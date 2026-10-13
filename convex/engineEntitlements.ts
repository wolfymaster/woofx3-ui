import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  engineNameFor,
  GRANT_PUSH_LEASE_MS,
  GRANT_RENEW_AFTER_MS,
  GRANT_RETRY_AFTER_MS,
  grantedCapabilities,
  isCapabilityId,
  isGrantSigningConfigured,
  nextGrantSeq,
  withheldReason,
} from "./lib/entitlementGrant";
import { scheduleGrantPush } from "./lib/entitlementGrantSchedule";
import { licenseFeatures } from "./lib/featureFlagAccess";
import { featureFlagRulesValidator, featureFlagStateValidator, validateFeatureFlagRules } from "./lib/featureFlags";

/**
 * Which gateable engine features managed engines may use. Operators target a
 * capability like a feature flag (state and rules, evaluated per instance);
 * Convex signs each managed engine's answer into a grant and pushes it
 * (entitlementGrantActions.push), and the engine enforces it. Self-hosted
 * engines ignore all of this: they have no keys to verify a grant with.
 */

const RENEWAL_BATCH = 100;
const PAGE_SIZE = 200;

/**
 * Sets a capability's targeting and re-grants every managed engine.
 * Operator-only, run from the CLI:
 *
 *   bunx convex run engineEntitlements:set '{"capability": "obs.control", "state": "rules", "rules": {"licenseFeature": "pro"}}'
 *
 * A capability may be targeted before any engine release has it; engines
 * ignore ids they do not know.
 */
export const set = internalMutation({
  args: {
    capability: v.string(),
    state: featureFlagStateValidator,
    rules: v.optional(featureFlagRulesValidator),
  },
  handler: async (ctx, { capability, state, rules }) => {
    if (!isCapabilityId(capability)) {
      throw new Error(`"${capability}" is not a capability id (<area>.<feature>)`);
    }
    if (state === "rules" && rules === undefined) {
      throw new Error('state "rules" needs rules');
    }
    if (state !== "rules" && rules !== undefined) {
      throw new Error(`state "${state}" ignores rules; set state "rules" to target`);
    }
    if (rules !== undefined) {
      validateFeatureFlagRules(rules);
    }
    const existing = await ctx.db
      .query("engineEntitlements")
      .withIndex("by_capability", (q) => q.eq("capability", capability))
      .unique();
    const row = { capability, state, rules, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("engineEntitlements", row);
    }
    await ctx.scheduler.runAfter(0, internal.engineEntitlements.renewAll, {});
  },
});

/** Deletes a capability's targeting, which withholds it from every governed engine, and re-grants. */
export const remove = internalMutation({
  args: { capability: v.string() },
  handler: async (ctx, { capability }) => {
    const existing = await ctx.db
      .query("engineEntitlements")
      .withIndex("by_capability", (q) => q.eq("capability", capability))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.renewAll, {});
    }
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("engineEntitlements").take(500);
  },
});

/** Why each of `capabilities` would be withheld: a plan the account lacks, or a rollout. */
export const withheldReasons = internalQuery({
  args: { capabilities: v.array(v.string()) },
  handler: async (ctx, { capabilities }): Promise<Record<string, "plan" | "rollout">> => {
    const reasons: Record<string, "plan" | "rollout"> = {};
    for (const capability of capabilities) {
      const row = await ctx.db
        .query("engineEntitlements")
        .withIndex("by_capability", (q) => q.eq("capability", capability))
        .unique();
      reasons[capability] = withheldReason(row);
    }
    return reasons;
  },
});

/**
 * Decides the instance's next grant and records its sequence number. Null
 * when the instance has no managed engine to send one to. Holds the row's
 * lease, so the renewal sweep leaves it alone while the push runs.
 */
export const prepareGrant = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const row = await ctx.db
      .query("entitlementGrants")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .unique();
    const instance = await ctx.db.get(instanceId);
    const provisioning = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    const engineId = provisioning?.maintenanceEngineId;
    const engineUp = provisioning?.status === "registered" || provisioning?.status === "upgrading";
    if (
      !instance ||
      instance.hosting !== "managed" ||
      !instance.clientId ||
      !instance.clientSecret ||
      !engineId ||
      !engineUp
    ) {
      if (row) {
        await ctx.db.delete(row._id);
      }
      return null;
    }

    const now = Date.now();
    const entitlementRows = await ctx.db.query("engineEntitlements").take(500);
    const grants = grantedCapabilities(entitlementRows, {
      accountId: instance.accountId,
      instanceId,
      hosting: "managed",
      licenseFeatures: await licenseFeatures(ctx, instance.accountId),
    });
    const seq = nextGrantSeq(row?.seq, now);
    const fields = { seq, grants, issuedAt: now, renewAt: now + GRANT_PUSH_LEASE_MS };
    if (row) {
      await ctx.db.patch(row._id, fields);
    } else {
      await ctx.db.insert("entitlementGrants", { instanceId, ...fields });
    }
    return {
      engineName: engineNameFor(engineId),
      seq,
      grants,
      nowMs: now,
      url: instance.url,
      clientId: instance.clientId,
      clientSecret: instance.clientSecret,
    };
  },
});

/** Records how a push went and when to push again. Ignores a push a newer grant has replaced. */
export const recordGrantPush = internalMutation({
  args: { instanceId: v.id("instances"), seq: v.number(), error: v.optional(v.string()) },
  handler: async (ctx, { instanceId, seq, error }) => {
    const row = await ctx.db
      .query("entitlementGrants")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .unique();
    if (!row || row.seq !== seq) {
      return;
    }
    const now = Date.now();
    if (error === undefined) {
      await ctx.db.patch(row._id, { pushedAt: now, lastError: undefined, renewAt: now + GRANT_RENEW_AFTER_MS });
    } else {
      await ctx.db.patch(row._id, { lastError: error, renewAt: now + GRANT_RETRY_AFTER_MS });
    }
  },
});

/** Cron: pushes every grant due for renewal, a batch at a time. */
export const scheduleDueRenewals = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!isGrantSigningConfigured()) {
      return;
    }
    const now = Date.now();
    const due = await ctx.db
      .query("entitlementGrants")
      .withIndex("by_renew_at", (q) => q.lte("renewAt", now))
      .take(RENEWAL_BATCH);
    for (const row of due) {
      await scheduleGrantPush(ctx, row.instanceId);
    }
    if (due.length === RENEWAL_BATCH) {
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.scheduleDueRenewals, {});
    }
  },
});

/** Marks every grant due now, after targeting changed. The renewal sweep then pushes them. */
export const renewAll = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("entitlementGrants").paginate({ cursor: cursor ?? null, numItems: PAGE_SIZE });
    const now = Date.now();
    for (const row of page.page) {
      await ctx.db.patch(row._id, { renewAt: now });
    }
    if (page.isDone) {
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.scheduleDueRenewals, {});
    } else {
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.renewAll, { cursor: page.continueCursor });
    }
  },
});

/**
 * Starts grants for managed engines registered before grants existed.
 * Run once per deployment from the CLI:
 *
 *   bunx convex run engineEntitlements:backfill
 */
export const backfill = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    if (!isGrantSigningConfigured()) {
      throw new Error("ENTITLEMENT_SIGNING_KEY is not set on this deployment");
    }
    const page = await ctx.db.query("engineProvisioning").paginate({ cursor: cursor ?? null, numItems: PAGE_SIZE });
    for (const provisioning of page.page) {
      if (provisioning.status !== "registered") {
        continue;
      }
      const existing = await ctx.db
        .query("entitlementGrants")
        .withIndex("by_instance", (q) => q.eq("instanceId", provisioning.instanceId))
        .unique();
      if (!existing) {
        await ctx.db.insert("entitlementGrants", {
          instanceId: provisioning.instanceId,
          seq: 0,
          grants: [],
          renewAt: Date.now(),
        });
      }
    }
    if (page.isDone) {
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.scheduleDueRenewals, {});
    } else {
      await ctx.scheduler.runAfter(0, internal.engineEntitlements.backfill, { cursor: page.continueCursor });
    }
  },
});
