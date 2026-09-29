import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, query } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { getInstanceMembership } from "./lib/teamAccess";
import {
  isStillLoadingError,
  type ParsedWorkflowHealth,
  parseWorkflowHealthChanged,
  parseWorkflowHealthList,
  parseWorkflowHealthSnapshot,
  planHealthWrite,
  planResync,
  planSnapshot,
  type ReplaceAllPlan,
  type StoredHealthRow,
  shouldResync,
} from "./lib/workflowHealth";
import { logger } from "./logger";

/**
 * Upper bound on stored error rows read per instance, so neither a replace-all
 * merge nor listNotRunning is an unbounded read. The workflows list itself
 * shows at most 100 rows, so a real instance stays far below it. Past the cap,
 * a replace-all clears only the errors it read and listNotRunning under-counts;
 * each later snapshot or resync clears another batch, so the state converges
 * rather than sticking.
 */
const MAX_ERROR_ROWS = 500;

type HealthRow = Doc<"workflowHealth">;

async function healthRow(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  engineWorkflowId: string
): Promise<HealthRow | null> {
  return ctx.db
    .query("workflowHealth")
    .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
    .unique();
}

async function writeHealth(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  existing: HealthRow | null,
  health: ParsedWorkflowHealth
): Promise<void> {
  const columns = {
    status: health.status,
    reason: health.reason,
    since: health.since,
    sinceMs: health.sinceMs,
    receivedAt: Date.now(),
  };
  if (existing === null) {
    await ctx.db.insert("workflowHealth", { instanceId, engineWorkflowId: health.engineWorkflowId, ...columns });
    return;
  }
  await ctx.db.patch(existing._id, columns);
}

/**
 * The rows a replace-all merge reads: every stored error (any of which the list
 * may clear) plus the stored row of every listed workflow (which a listed entry
 * may replace).
 */
async function rowsForReplaceAll(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  listed: readonly ParsedWorkflowHealth[]
): Promise<Map<string, HealthRow>> {
  const errors = await ctx.db
    .query("workflowHealth")
    .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "error"))
    .take(MAX_ERROR_ROWS);
  const rows = new Map(errors.map((row) => [row.engineWorkflowId, row]));
  for (const entry of listed) {
    if (rows.has(entry.engineWorkflowId)) {
      continue;
    }
    const row = await healthRow(ctx, instanceId, entry.engineWorkflowId);
    if (row !== null) {
      rows.set(row.engineWorkflowId, row);
    }
  }
  return rows;
}

function toStored(row: HealthRow): StoredHealthRow {
  return {
    engineWorkflowId: row.engineWorkflowId,
    status: row.status,
    reason: row.reason,
    sinceMs: row.sinceMs,
    since: row.since,
    receivedAt: row.receivedAt,
  };
}

async function applyReplaceAll(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  rows: Map<string, HealthRow>,
  plan: ReplaceAllPlan
): Promise<{ written: number; cleared: number }> {
  for (const health of [...plan.writes, ...plan.clears]) {
    await writeHealth(ctx, instanceId, rows.get(health.engineWorkflowId) ?? null, health);
  }
  return { written: plan.writes.length, cleared: plan.clears.length };
}

/** One `workflow.health.changed` delivery. */
export const recordChangedFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    data: v.any(),
  },
  handler: async (ctx, { instanceId, data }) => {
    const parsed = parseWorkflowHealthChanged(data);
    if (!parsed.ok) {
      return { outcome: "invalid" as const, reason: parsed.reason };
    }
    const existing = await healthRow(ctx, instanceId, parsed.health.engineWorkflowId);
    const plan = planHealthWrite(existing, parsed.health);
    if (plan === "insert" || plan === "replace") {
      await writeHealth(ctx, instanceId, existing, parsed.health);
    }
    return { outcome: plan };
  },
});

/** One `workflow.health.snapshot` delivery: replaces the instance's health. */
export const recordSnapshotFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    data: v.any(),
  },
  handler: async (ctx, { instanceId, data }) => {
    const parsed = parseWorkflowHealthSnapshot(data);
    if (!parsed.ok) {
      return { outcome: "invalid" as const, reason: parsed.reason };
    }
    const rows = await rowsForReplaceAll(ctx, instanceId, parsed.snapshot.entries);
    const plan = planSnapshot(Array.from(rows.values(), toStored), parsed.snapshot);
    const counts = await applyReplaceAll(ctx, instanceId, rows, plan);
    return { outcome: "applied" as const, ...counts };
  },
});

/** Drop a deleted workflow's health so nothing is left to count against it. */
export async function deleteWorkflowHealth(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  engineWorkflowId: string
): Promise<void> {
  const row = await healthRow(ctx, instanceId, engineWorkflowId);
  if (row !== null) {
    await ctx.db.delete(row._id);
  }
}

export interface NotRunningWorkflow {
  engineWorkflowId: string;
  reason: string | null;
  since: string;
}

/**
 * Enabled workflows the engine reports it is not running on their own. An
 * error on a workflow that is disabled or not yet mirrored is left out: the
 * engine clears those itself when it stops trying to run them, and until the
 * mirror lands there is no row to put a badge on.
 */
export const listNotRunning = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<NotRunningWorkflow[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }
    const errors = await ctx.db
      .query("workflowHealth")
      .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", "error"))
      .take(MAX_ERROR_ROWS);
    const result: NotRunningWorkflow[] = [];
    for (const row of errors) {
      const workflow = await ctx.db
        .query("workflows")
        .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", row.engineWorkflowId))
        .first();
      if (workflow?.isEnabled) {
        result.push({ engineWorkflowId: row.engineWorkflowId, reason: row.reason ?? null, since: row.since });
      }
    }
    return result;
  },
});

export const engineContextForMember = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance?.clientId || !instance.clientSecret) {
      return null;
    }
    return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
  },
});

const resyncTrigger = v.union(v.literal("mount"), v.literal("reconnect"));

/**
 * Take the instance's resync slot if its throttle allows. A mutation, so two
 * tabs asking at once cannot both win.
 */
export const claimResync = internalMutation({
  args: { instanceId: v.id("instances"), trigger: resyncTrigger },
  handler: async (ctx, { instanceId, trigger }): Promise<boolean> => {
    const now = Date.now();
    const row = await ctx.db
      .query("workflowHealthSyncs")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .unique();
    if (!shouldResync(row?.attemptedAt ?? null, now, trigger)) {
      return false;
    }
    if (row === null) {
      await ctx.db.insert("workflowHealthSyncs", { instanceId, attemptedAt: now });
    } else {
      await ctx.db.patch(row._id, { attemptedAt: now, outcome: undefined });
    }
    return true;
  },
});

export const finishResync = internalMutation({
  args: {
    instanceId: v.id("instances"),
    outcome: v.union(v.literal("ok"), v.literal("unsupported"), v.literal("failed")),
  },
  handler: async (ctx, { instanceId, outcome }) => {
    const row = await ctx.db
      .query("workflowHealthSyncs")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .unique();
    if (row !== null) {
      await ctx.db.patch(row._id, { outcome });
    }
  },
});

/**
 * Give the throttle slot back after an attempt that told us nothing, so the
 * next mount or reconnect asks again instead of waiting out the interval.
 */
export const releaseResync = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const row = await ctx.db
      .query("workflowHealthSyncs")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .unique();
    if (row !== null) {
      await ctx.db.delete(row._id);
    }
  },
});

export const applyResync = internalMutation({
  args: {
    instanceId: v.id("instances"),
    result: v.any(),
    fetchStartedAt: v.number(),
  },
  handler: async (ctx, { instanceId, result, fetchStartedAt }) => {
    const parsed = parseWorkflowHealthList(result);
    if (!parsed.ok) {
      return { outcome: "invalid" as const, reason: parsed.reason };
    }
    const rows = await rowsForReplaceAll(ctx, instanceId, parsed.entries);
    const plan = planResync(Array.from(rows.values(), toStored), parsed.entries, fetchStartedAt);
    const counts = await applyReplaceAll(ctx, instanceId, rows, plan);
    return { outcome: "applied" as const, ...counts };
  },
});

export type ResyncResult = "skipped" | "ok" | "unsupported" | "loading" | "failed";

/**
 * Ask the engine for every workflow's health and replace what is stored.
 * Webhooks normally keep health current; this repairs a delivery Convex missed.
 * Throttled per instance (see RESYNC_MIN_INTERVAL_MS), and it never throws for
 * an engine problem: callers fire it in the background, an engine that
 * predates the RPC simply has no health to show, and one still loading its
 * workflows is asked again on the next trigger.
 */
export const resync = action({
  args: { instanceId: v.id("instances"), trigger: resyncTrigger },
  handler: async (ctx, { instanceId, trigger }): Promise<ResyncResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const engine = await ctx.runQuery(internal.workflowHealth.engineContextForMember, { instanceId, userId });
    if (!engine) {
      return "skipped";
    }
    const claimed = await ctx.runMutation(internal.workflowHealth.claimResync, { instanceId, trigger });
    if (!claimed) {
      return "skipped";
    }

    let supported: boolean;
    try {
      supported = hasEngineCapability(await fetchEngineCapabilities(engine), "workflow.health");
    } catch (err) {
      logger.warn("workflow health: capability check failed", {
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.runMutation(internal.workflowHealth.finishResync, { instanceId, outcome: "failed" });
      return "failed";
    }
    if (!supported) {
      await ctx.runMutation(internal.workflowHealth.finishResync, { instanceId, outcome: "unsupported" });
      return "unsupported";
    }

    const fetchStartedAt = Date.now();
    let result: unknown;
    try {
      result = await createEngineRpcSession<EngineApi>(
        engine.url,
        engine.clientId,
        engine.clientSecret
      ).getWorkflowHealth();
    } catch (err) {
      // An engine still loading its workflows cannot give a whole list yet, and
      // sends its own snapshot once it can. Not a failure, and not a reason to
      // hold the throttle.
      if (isStillLoadingError(err)) {
        await ctx.runMutation(internal.workflowHealth.releaseResync, { instanceId });
        return "loading";
      }
      logger.warn("workflow health: resync failed", {
        instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.runMutation(internal.workflowHealth.finishResync, { instanceId, outcome: "failed" });
      return "failed";
    }

    const applied = await ctx.runMutation(internal.workflowHealth.applyResync, {
      instanceId,
      result,
      fetchStartedAt,
    });
    if (applied.outcome === "invalid") {
      logger.warn("workflow health: engine returned a malformed list", { instanceId, reason: applied.reason });
      await ctx.runMutation(internal.workflowHealth.finishResync, { instanceId, outcome: "failed" });
      return "failed";
    }
    await ctx.runMutation(internal.workflowHealth.finishResync, { instanceId, outcome: "ok" });
    return "ok";
  },
});
