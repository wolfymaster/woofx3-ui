import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { confirmedCompanionByToken } from "./lib/companionAuth";
import {
  activeInstanceCompanion,
  bridgeAvailable,
  companionEndpointRows,
  installedLocalEndpoint,
  installedLocalModules,
  instanceCompanion,
  MAX_BRIDGED_ENDPOINTS,
} from "./lib/companionEndpoints";
import { isEndpointHost, isEndpointPort, localSettingKeys } from "./lib/localEndpoints";
import { isInstanceMember } from "./lib/teamAccess";

/**
 * What the instance's companion does for the local endpoints of installed
 * modules (the companion's Integrations tab), and the browser's view of it on
 * a module's settings page. Companion functions authenticate with its token
 * and need a companion the person at the PC has confirmed.
 */

const rateLimiter = new RateLimiter(components.rateLimiter, {
  companionEndpointWrites: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
});

const discoverValidator = v.object({ mdns: v.optional(v.string()), known: v.optional(v.string()) });
const addressValidator = v.object({ host: v.string(), port: v.number() });
const endpointStateValidator = v.object({
  enabled: v.boolean(),
  address: v.union(addressValidator, v.null()),
  discovered: v.boolean(),
  sharesPassword: v.boolean(),
});

/**
 * The companion's view of its instance: each installed module's local
 * endpoints, the setting keys they name (never values), what the companion
 * last recorded for each, and which keys the streamer set by hand so the
 * companion must not report them. Null when the token is not a confirmed
 * companion's, which the companion reads as "integrations are off".
 */
export const forCompanion = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      relayAvailable: v.boolean(),
      modules: v.array(
        v.object({
          moduleId: v.string(),
          moduleName: v.string(),
          endpoints: v.array(
            v.object({
              id: v.string(),
              name: v.string(),
              protocol: v.union(v.literal("websocket"), v.literal("http")),
              discover: v.union(discoverValidator, v.null()),
              keys: v.object({ host: v.string(), port: v.string(), password: v.optional(v.string()) }),
              state: v.union(endpointStateValidator, v.null()),
              manualKeys: v.array(v.string()),
            })
          ),
        })
      ),
    })
  ),
  handler: async (ctx, { token }) => {
    const companion = await confirmedCompanionByToken(ctx, token);
    if (!companion) {
      return null;
    }
    const [modules, rows] = await Promise.all([
      installedLocalModules(ctx, companion.instanceId),
      companionEndpointRows(ctx, companion._id),
    ]);
    const result = [];
    for (const module of modules) {
      const provenance = await ctx.db
        .query("moduleSettingProvenance")
        .withIndex("by_instance_module", (q) =>
          q.eq("instanceId", companion.instanceId).eq("moduleId", module.moduleId)
        )
        .take(50);
      const manual = new Set(provenance.filter((row) => row.source === "manual").map((row) => row.key));
      result.push({
        moduleId: module.moduleId,
        moduleName: module.moduleName,
        endpoints: module.endpoints.map((endpoint) => {
          const row = rows.find((r) => r.moduleId === module.moduleId && r.endpointId === endpoint.id);
          return {
            id: endpoint.id,
            name: endpoint.name,
            protocol: endpoint.protocol,
            discover: endpoint.discover ?? null,
            keys: {
              host: endpoint.hostSetting,
              port: endpoint.portSetting,
              ...(endpoint.passwordSetting ? { password: endpoint.passwordSetting } : {}),
            },
            state: row
              ? {
                  enabled: row.enabled,
                  address: row.address ?? null,
                  discovered: row.discovered,
                  sharesPassword: row.sharesPassword,
                }
              : null,
            manualKeys: localSettingKeys(endpoint).filter((key) => manual.has(key)),
          };
        }),
      });
    }
    return { relayAvailable: bridgeAvailable(), modules: result };
  },
});

/**
 * The companion records what it does for one endpoint. The address is a copy
 * for display: the companion dials only addresses it keeps itself. Enabling
 * needs an address, so the browser always has something true to show.
 */
export const setEndpoint = mutation({
  args: {
    token: v.string(),
    moduleId: v.string(),
    endpointId: v.string(),
    enabled: v.boolean(),
    address: v.optional(addressValidator),
    discovered: v.boolean(),
    sharesPassword: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const companion = await confirmedCompanionByToken(ctx, args.token);
    if (!companion) {
      throw new ConvexError("This companion is not paired and confirmed.");
    }
    const limit = await rateLimiter.limit(ctx, "companionEndpointWrites", { key: companion._id });
    if (!limit.ok) {
      throw new ConvexError("Too many integration changes. Try again in a few minutes.");
    }
    const endpoint = await installedLocalEndpoint(ctx, companion.instanceId, args.moduleId, args.endpointId);
    if (!endpoint) {
      throw new ConvexError("No module installed on this instance declares that endpoint.");
    }
    if (args.address && (!isEndpointHost(args.address.host) || !isEndpointPort(args.address.port))) {
      throw new ConvexError("The address must be a host name or IP address and a port from 1 to 65535.");
    }
    if (args.enabled && !args.address) {
      throw new ConvexError("An endpoint needs an address before it can be turned on.");
    }

    const existing = await ctx.db
      .query("companionEndpoints")
      .withIndex("by_companion_endpoint", (q) =>
        q.eq("companionId", companion._id).eq("moduleId", args.moduleId).eq("endpointId", args.endpointId)
      )
      .first();
    if (args.enabled && !existing?.enabled) {
      const enabled = (await companionEndpointRows(ctx, companion._id)).filter((row) => row.enabled);
      if (enabled.length >= MAX_BRIDGED_ENDPOINTS) {
        throw new ConvexError(`A companion can carry at most ${MAX_BRIDGED_ENDPOINTS} integrations.`);
      }
    }
    const fields = {
      enabled: args.enabled,
      address: args.address,
      discovered: args.discovered,
      sharesPassword: args.sharesPassword,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.replace(existing._id, {
        companionId: companion._id,
        instanceId: companion.instanceId,
        moduleId: args.moduleId,
        endpointId: args.endpointId,
        ...fields,
      });
    } else {
      await ctx.db.insert("companionEndpoints", {
        companionId: companion._id,
        instanceId: companion.instanceId,
        moduleId: args.moduleId,
        endpointId: args.endpointId,
        ...fields,
      });
    }
    return null;
  },
});

/**
 * A module's local endpoints as its settings page shows them: the instance's
 * companion, what it does for each endpoint, and which settings it provided.
 * Members only. `lastSeenAt` is null until the first heartbeat; whether that
 * is "online" is judged in the browser, since this query does not re-run as
 * time passes.
 */
export const forModule = query({
  args: { instanceId: v.id("instances"), moduleId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      bridgeAvailable: v.boolean(),
      endpoints: v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          protocol: v.union(v.literal("websocket"), v.literal("http")),
          hasDiscovery: v.boolean(),
          hostSetting: v.string(),
          portSetting: v.string(),
          passwordSetting: v.union(v.string(), v.null()),
          state: v.union(endpointStateValidator, v.null()),
        })
      ),
      companion: v.union(
        v.null(),
        v.object({ deviceName: v.string(), lastSeenAt: v.union(v.number(), v.null()), confirmed: v.boolean() })
      ),
      provenance: v.array(v.object({ key: v.string(), source: v.union(v.literal("companion"), v.literal("manual")) })),
    })
  ),
  handler: async (ctx, { instanceId, moduleId }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const module = (await installedLocalModules(ctx, instanceId)).find((m) => m.moduleId === moduleId);
    const companion = await instanceCompanion(ctx, instanceId);
    const active = await activeInstanceCompanion(ctx, instanceId);
    const rows = active ? await companionEndpointRows(ctx, active._id) : [];
    const presence = companion
      ? await ctx.db
          .query("companionPresence")
          .withIndex("by_companion", (q) => q.eq("companionId", companion._id))
          .first()
      : null;
    const provenance = await ctx.db
      .query("moduleSettingProvenance")
      .withIndex("by_instance_module", (q) => q.eq("instanceId", instanceId).eq("moduleId", moduleId))
      .take(50);
    return {
      bridgeAvailable: bridgeAvailable(),
      endpoints: (module?.endpoints ?? []).map((endpoint) => {
        const row = rows.find((r) => r.moduleId === moduleId && r.endpointId === endpoint.id);
        return {
          id: endpoint.id,
          name: endpoint.name,
          protocol: endpoint.protocol,
          hasDiscovery: endpoint.discover !== undefined,
          hostSetting: endpoint.hostSetting,
          portSetting: endpoint.portSetting,
          passwordSetting: endpoint.passwordSetting ?? null,
          state: row
            ? {
                enabled: row.enabled,
                address: row.address ?? null,
                discovered: row.discovered,
                sharesPassword: row.sharesPassword,
              }
            : null,
        };
      }),
      companion: companion
        ? {
            deviceName: companion.deviceName,
            lastSeenAt: presence?.lastSeenAt ?? null,
            confirmed: active !== null,
          }
        : null,
      provenance: provenance.map((row) => ({ key: row.key, source: row.source })),
    };
  },
});
