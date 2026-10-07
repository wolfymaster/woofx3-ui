"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction } from "./_generated/server";
import { bridgeAvailable } from "./lib/companionEndpoints";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import {
  bridgeOrigin,
  isCompanionHostname,
  type RelayCredentialRequestedResponse,
  type RelayEngineApi,
} from "./lib/engineRelay";
import { ensureCompanionRoute, isMaintenanceConfigured, removeCompanionRoute } from "./lib/maintenanceClient";
import { RELAY_CREDENTIAL_LIFETIME_SECONDS, relaySigningKey, signRelayCredential } from "./lib/relayCredential";

/**
 * Relay credentials for the companion and the engine, and the engine's relay
 * configuration. Convex is the only minter of relay credentials; the signing
 * key never leaves this deployment.
 */

/** The instance's relay hostname, allocating it through the maintenance API the first time. */
async function ensureRoute(ctx: ActionCtx, instanceId: Id<"instances">): Promise<string> {
  const { hostname } = await ensureCompanionRoute(instanceId);
  if (typeof hostname !== "string" || !isCompanionHostname(hostname)) {
    throw new Error(`The maintenance API answered a companion route without a valid hostname: ${String(hostname)}`);
  }
  await ctx.runMutation(internal.companionRelay.setHostname, { instanceId, hostname });
  return hostname;
}

/**
 * The companion's credential for the relay. Re-minted every few minutes, so
 * revoking or replacing the companion cuts it off within one lifetime. Null
 * when woofx3 will not issue one: the relay is not configured here, the token
 * is not a confirmed companion's, or nothing is enabled to bridge.
 */
export const companionCredential = action({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ relayUrl: v.string(), credential: v.string(), expiresAt: v.number() })),
  handler: async (ctx, { token }) => {
    const relayUrl = process.env.RELAY_URL;
    const key = relaySigningKey();
    if (!key || !relayUrl || !isMaintenanceConfigured()) {
      return null;
    }
    const subject = await ctx.runQuery(internal.companionRelay.credentialSubject, { token });
    if (!subject) {
      return null;
    }
    await ctx.runMutation(internal.companionRelay.consumeCredentialBudget, { companionId: subject.companionId });
    const hostname = subject.hostname ?? (await ensureRoute(ctx, subject.instanceId));
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + RELAY_CREDENTIAL_LIFETIME_SECONDS;
    const credential = await signRelayCredential(
      { v: 1, aud: "companion", ins: subject.instanceId, host: hostname, cid: subject.companionId, iat, exp },
      key
    );
    return { relayUrl, credential, expiresAt: exp * 1000 };
  },
});

/**
 * The answer to the engine's `relay.credential.requested` callback. The
 * answer is authoritative: `{ relay: null }` makes the engine clear its relay
 * configuration, which heals an engine that missed a `setRelayConfig(null)`.
 */
export const engineCredential = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<RelayCredentialRequestedResponse> => {
    const key = relaySigningKey();
    if (!key || !bridgeAvailable()) {
      return { relay: null };
    }
    const target = await ctx.runQuery(internal.companionRelay.relayTarget, { instanceId });
    if (!target || target.endpoints.length === 0) {
      return { relay: null };
    }
    const hostname = target.hostname ?? (await ensureRoute(ctx, instanceId));
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + RELAY_CREDENTIAL_LIFETIME_SECONDS;
    const credential = await signRelayCredential(
      { v: 1, aud: "engine", ins: instanceId, host: hostname, iat, exp },
      key
    );
    return {
      relay: { bridgeOrigin: bridgeOrigin(hostname), endpoints: target.endpoints, credential, expiresAt: exp * 1000 },
    };
  },
});

/** Delays before retrying a failed sync. After the last, the engine's next credential request heals it. */
const SYNC_RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000];

/**
 * Tell the engine which endpoints to reach through the companion's bridge, or
 * that none are. Scheduled by `scheduleRelaySync` whenever that set may have
 * changed (an endpoint turned on or off, the companion confirmed, re-paired,
 * revoked or replaced, its approver's role changed, a module uninstalled, the
 * engine registered again), and every 15 minutes by `resyncBridgedInstances`.
 * A run whose `version` is no longer the instance's `relaySyncVersion` was
 * overtaken by a newer change and does nothing. An engine without
 * `modules.localEndpoints` gets nothing, and keeps reaching endpoints directly.
 */
export const syncEngine = internalAction({
  args: { instanceId: v.id("instances"), version: v.number(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { instanceId, version, attempt = 0 }) => {
    const first = await ctx.runQuery(internal.companionRelay.relayTarget, { instanceId });
    if (!first?.engine || first.syncVersion !== version) {
      return null;
    }
    const engine = first.engine;
    try {
      const capabilities = await fetchEngineCapabilities(engine);
      if (!hasEngineCapability(capabilities, "modules.localEndpoints")) {
        return null;
      }
      // Read again after the round trip, so what is sent is current and a run
      // overtaken while it waited sends nothing.
      const target = await ctx.runQuery(internal.companionRelay.relayTarget, { instanceId });
      if (!target?.engine || target.syncVersion !== version) {
        return null;
      }
      const endpoints = bridgeAvailable() ? target.endpoints : [];
      const config =
        endpoints.length > 0
          ? { bridgeOrigin: bridgeOrigin(target.hostname ?? (await ensureRoute(ctx, instanceId))), endpoints }
          : null;
      // Its own session: an HTTP batch session is spent by its first call.
      await createEngineRpcSession<RelayEngineApi>(engine.url, engine.clientId, engine.clientSecret).setRelayConfig(
        config
      );
    } catch (error) {
      const delay = SYNC_RETRY_DELAYS_MS[attempt];
      const message = error instanceof Error ? error.message : String(error);
      if (delay === undefined) {
        console.warn("[companionRelay.syncEngine] giving up; the engine's next credential request heals it", {
          instanceId,
          error: message,
        });
        return null;
      }
      console.warn("[companionRelay.syncEngine] failed, retrying", { instanceId, attempt, error: message });
      await ctx.scheduler.runAfter(delay, internal.companionRelayActions.syncEngine, {
        instanceId,
        version,
        attempt: attempt + 1,
      });
    }
    return null;
  },
});

/** Remove the instance's relay hostname when the instance is deleted. Best effort. */
export const removeRoute = internalAction({
  args: { instanceId: v.string() },
  returns: v.null(),
  handler: async (_ctx, { instanceId }) => {
    if (!isMaintenanceConfigured()) {
      return null;
    }
    try {
      await removeCompanionRoute(instanceId);
    } catch (error) {
      console.warn("[companionRelay.removeRoute] failed", {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});
