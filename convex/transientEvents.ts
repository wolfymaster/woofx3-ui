import { type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";
import { TRANSIENT_SWEEP_BATCH } from "./lib/engineEvents/config";
import { isInstanceMember } from "./lib/teamAccess";

const DEFAULT_TTL_MS = 60_000;

/**
 * Whether a row is still live. The sweep deletes expired rows up to a minute
 * late, so every reader checks the expiry itself.
 */
function isLive(row: Doc<"transientEvents">, now: number): boolean {
  return row.expiresAt > now;
}

/**
 * Subscribe to a transient event by instanceId + correlationKey.
 * Returns the most recent event, or null if none exists yet.
 * Convex realtime pushes updates the moment an event is written.
 *
 * Null for a caller who is not a member: correlation keys are guessable
 * (many are `{kind}:{id}`) and events carry engine replies such as run
 * results and module uninstall outcomes.
 */
export const get = query({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return null;
    }
    const latest = await ctx.db
      .query("transientEvents")
      .withIndex("by_instance_correlation", (q) =>
        q.eq("instanceId", args.instanceId).eq("correlationKey", args.correlationKey)
      )
      .order("desc")
      .first();
    return latest !== null && isLive(latest, Date.now()) ? latest : null;
  },
});

/**
 * Every transient event under one correlation key, oldest first.
 *
 * `get` answers with the latest row, which is enough when one run answers to
 * the key. A simulated event can start several workflows under the same key,
 * and a caller following one of them needs all the rows to find its own. The
 * bound is generous: rows expire after a minute.
 */
export const listByCorrelation = query({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await isInstanceMember(ctx, args.instanceId))) {
      return [];
    }
    const now = Date.now();
    const rows = await ctx.db
      .query("transientEvents")
      .withIndex("by_instance_correlation", (q) =>
        q.eq("instanceId", args.instanceId).eq("correlationKey", args.correlationKey)
      )
      .take(200);
    return rows.filter((row) => isLive(row, now));
  },
});

const emitArgs = {
  instanceId: v.id("instances"),
  correlationKey: v.string(),
  type: v.string(),
  status: v.union(v.literal("progress"), v.literal("success"), v.literal("error")),
  message: v.optional(v.string()),
  data: v.optional(v.any()),
  ttlMs: v.optional(v.number()),
};

export async function emitTransientEvent(
  ctx: MutationCtx,
  args: ObjectType<typeof emitArgs>
): Promise<Id<"transientEvents">> {
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = Date.now() + ttl;

  return await ctx.db.insert("transientEvents", {
    instanceId: args.instanceId,
    correlationKey: args.correlationKey,
    type: args.type,
    status: args.status,
    message: args.message,
    data: args.data,
    expiresAt,
  });
}

/**
 * Emit a transient event. The event is automatically scheduled for cleanup after TTL.
 */
export const emit = internalMutation({
  args: emitArgs,
  handler: async (ctx, args) => {
    return await emitTransientEvent(ctx, args);
  },
});

/**
 * Emit a transient event unless one was already written under the key at or
 * after `since`. For an event that can only be sent after the work it
 * describes started elsewhere: `get` answers with the newest row, so a late
 * "progress" written after the engine's own "success" or "error" callback
 * would mask the outcome.
 */
export const emitUnlessNewer = internalMutation({
  args: { ...emitArgs, since: v.number() },
  handler: async (ctx, { since, ...args }): Promise<Id<"transientEvents"> | null> => {
    const latest = await ctx.db
      .query("transientEvents")
      .withIndex("by_instance_correlation", (q) =>
        q.eq("instanceId", args.instanceId).eq("correlationKey", args.correlationKey)
      )
      .order("desc")
      .first();
    if (latest !== null && latest._creationTime >= since) {
      return null;
    }
    return await emitTransientEvent(ctx, args);
  },
});

/**
 * Deletes expired rows, oldest first, a page at a time; runs from a cron. A
 * full page reschedules at once, so a backlog drains without waiting for the
 * next tick.
 */
export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("transientEvents")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .take(TRANSIENT_SWEEP_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    if (expired.length === TRANSIENT_SWEEP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.transientEvents.sweepExpired, {});
    }
  },
});
