import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { confirmedCompanionByToken } from "./lib/companionAuth";
import { activeInstanceCompanion, bridgedEndpoints } from "./lib/companionEndpoints";

/**
 * The database half of the companion relay: who may get a relay credential,
 * which endpoints an instance bridges, and the instance's relay hostname. The
 * actions that mint credentials and talk to the engine are in
 * companionRelayActions.ts.
 */

// A companion re-mints at two thirds of a five-minute lifetime, plus once per
// reconnect, so 30 in ten minutes is far above ordinary use.
const rateLimiter = new RateLimiter(components.rateLimiter, {
  companionRelayCredentials: { kind: "token bucket", rate: 30, period: 10 * MINUTE, capacity: 10 },
});

const endpointRefValidator = v.object({ moduleId: v.string(), endpointId: v.string() });

/**
 * Who a companion relay credential would be for. Only a confirmed companion
 * with an endpoint to bridge gets one, so a revoked, replaced or idle
 * companion cannot hold the relay connection open.
 */
export const credentialSubject = internalQuery({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      companionId: v.id("companions"),
      instanceId: v.id("instances"),
      hostname: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, { token }) => {
    const companion = await confirmedCompanionByToken(ctx, token);
    if (!companion) {
      return null;
    }
    if ((await bridgedEndpoints(ctx, companion)).length === 0) {
      return null;
    }
    const instance = await ctx.db.get(companion.instanceId);
    if (!instance) {
      return null;
    }
    return {
      companionId: companion._id,
      instanceId: companion.instanceId,
      hostname: instance.companionHostname ?? null,
    };
  },
});

export const consumeCredentialBudget = internalMutation({
  args: { companionId: v.id("companions") },
  returns: v.null(),
  handler: async (ctx, { companionId }) => {
    const limit = await rateLimiter.limit(ctx, "companionRelayCredentials", { key: companionId });
    if (!limit.ok) {
      throw new ConvexError("Too many relay credential requests. Try again in a few minutes.");
    }
    return null;
  },
});

/**
 * What the engine of an instance should do with its bridge: the endpoints to
 * route through the companion (empty when there is no confirmed companion or
 * nothing is enabled), the relay hostname, and the engine's credentials.
 */
export const relayTarget = internalQuery({
  args: { instanceId: v.id("instances") },
  returns: v.union(
    v.null(),
    v.object({
      engine: v.union(v.null(), v.object({ url: v.string(), clientId: v.string(), clientSecret: v.string() })),
      hostname: v.union(v.string(), v.null()),
      endpoints: v.array(endpointRefValidator),
      syncVersion: v.number(),
    })
  ),
  handler: async (ctx, { instanceId }) => {
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    const companion = await activeInstanceCompanion(ctx, instanceId);
    return {
      engine:
        instance.clientId && instance.clientSecret
          ? { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret }
          : null,
      hostname: instance.companionHostname ?? null,
      endpoints: companion ? await bridgedEndpoints(ctx, companion) : [],
      syncVersion: instance.relaySyncVersion ?? 0,
    };
  },
});

export const setHostname = internalMutation({
  args: { instanceId: v.id("instances"), hostname: v.string() },
  returns: v.null(),
  handler: async (ctx, { instanceId, hostname }) => {
    const instance = await ctx.db.get(instanceId);
    if (instance && instance.companionHostname !== hostname) {
      await ctx.db.patch(instanceId, { companionHostname: hostname });
    }
    return null;
  },
});

const RESYNC_PAGE_SIZE = 200;

/**
 * Push the relay configuration again to every instance with an endpoint
 * turned on, every 15 minutes (crons.ts). An engine restarted, or a session
 * that cleared its configuration with `setRelayConfig(null)`, gets it back
 * within one interval. Walks only enabled endpoint rows, a page at a time, so
 * an idle deployment costs one empty index read. Each run is scheduled at the
 * instance's current `relaySyncVersion` without bumping it, so a change made
 * meanwhile takes precedence.
 */
export const resyncBridgedInstances = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), lastInstanceId: v.optional(v.id("instances")) },
  returns: v.null(),
  handler: async (ctx, { cursor, lastInstanceId }) => {
    const page = await ctx.db
      .query("companionEndpoints")
      .withIndex("by_enabled_instance", (q) => q.eq("enabled", true))
      .paginate({ numItems: RESYNC_PAGE_SIZE, cursor: cursor ?? null });
    // Rows are ordered by instance, so an instance's rows are consecutive and
    // can only straddle the boundary with the previous page.
    let previous: Id<"instances"> | undefined = lastInstanceId;
    for (const row of page.page) {
      if (row.instanceId === previous) {
        continue;
      }
      previous = row.instanceId;
      const instance = await ctx.db.get(row.instanceId);
      if (instance) {
        await ctx.scheduler.runAfter(0, internal.companionRelayActions.syncEngine, {
          instanceId: row.instanceId,
          version: instance.relaySyncVersion ?? 0,
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.companionRelay.resyncBridgedInstances, {
        cursor: page.continueCursor,
        lastInstanceId: previous,
      });
    }
    return null;
  },
});
