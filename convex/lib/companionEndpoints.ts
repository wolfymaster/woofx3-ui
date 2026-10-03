import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { approvalStands } from "./companionAuth";
import { MAX_COMPANION_ROWS_PER_INSTANCE } from "./companionCodes";
import { type LocalEndpoint, readLocalEndpoints } from "./localEndpoints";
import { isMaintenanceConfigured } from "./maintenanceClient";
import { bareModuleKey } from "./moduleKey";
import { isRelayConfigured } from "./relayCredential";

/** The bound on module rows read per instance; one row per installed module. */
const MAX_MODULE_ROWS = 200;

/** Endpoint rows per companion: one per local[] entry of an installed module. */
export const MAX_ENDPOINT_ROWS_PER_COMPANION = 100;

/**
 * The most endpoints one relay configuration may route through the bridge;
 * the engine refuses a larger one. Must match MAX_RELAY_ENDPOINTS in woofx3
 * shared/common/typescript/cloudevents/Relay/relay.ts.
 */
export const MAX_BRIDGED_ENDPOINTS = 50;

export interface InstalledLocalModule {
  /** The module's manifest id, which the engine and the bridge path name it by. */
  moduleId: string;
  moduleName: string;
  endpoints: LocalEndpoint[];
}

/**
 * The modules installed on an instance that declare local endpoints. Keyed by
 * the bare module key, the way module-install.tsx matches catalogue entries to
 * installed rows; an upgrade can leave the superseded row behind, so only
 * `installed` rows count.
 */
export async function installedLocalModules(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<InstalledLocalModule[]> {
  const rows = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_MODULE_ROWS);
  const modules = new Map<string, InstalledLocalModule>();
  for (const row of rows) {
    if (row.status !== "installed") {
      continue;
    }
    const moduleId = bareModuleKey(row.moduleKey);
    if (!moduleId || modules.has(moduleId)) {
      continue;
    }
    const endpoints = readLocalEndpoints(row.manifest);
    if (endpoints.length > 0) {
      modules.set(moduleId, { moduleId, moduleName: row.name, endpoints });
    }
  }
  return Array.from(modules.values()).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

/** One installed module's endpoint, or null when the module is not installed or does not declare it. */
export async function installedLocalEndpoint(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  moduleId: string,
  endpointId: string
): Promise<LocalEndpoint | null> {
  const modules = await installedLocalModules(ctx, instanceId);
  const module = modules.find((m) => m.moduleId === moduleId);
  return module?.endpoints.find((e) => e.id === endpointId) ?? null;
}

/**
 * The instance's companion. An instance has at most one (approving a new one
 * replaces it); should older rows remain, the most recently paired wins.
 */
export async function instanceCompanion(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Doc<"companions"> | null> {
  const rows = await ctx.db
    .query("companions")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(MAX_COMPANION_ROWS_PER_INSTANCE);
  let latest: Doc<"companions"> | null = null;
  for (const row of rows) {
    if (!latest || row.pairedAt > latest.pairedAt) {
      latest = row;
    }
  }
  return latest;
}

/** The instance's companion when it may act for the instance: confirmed on the device, its approval still standing. */
export async function activeInstanceCompanion(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<Doc<"companions"> | null> {
  const companion = await instanceCompanion(ctx, instanceId);
  if (!companion || companion.confirmedAt === undefined || !(await approvalStands(ctx, companion))) {
    return null;
  }
  return companion;
}

export async function companionEndpointRows(
  ctx: QueryCtx,
  companionId: Id<"companions">
): Promise<Doc<"companionEndpoints">[]> {
  return ctx.db
    .query("companionEndpoints")
    .withIndex("by_companion", (q) => q.eq("companionId", companionId))
    .take(MAX_ENDPOINT_ROWS_PER_COMPANION);
}

/**
 * The endpoints the engine should reach through this companion's bridge:
 * enabled, declared by a module installed on the instance, and `websocket`,
 * the only protocol the bridge carries. Sorted, so an unchanged set compares
 * equal.
 */
export async function bridgedEndpoints(
  ctx: QueryCtx,
  companion: Doc<"companions">
): Promise<{ moduleId: string; endpointId: string }[]> {
  const rows = await companionEndpointRows(ctx, companion._id);
  if (!rows.some((row) => row.enabled)) {
    return [];
  }
  const modules = await installedLocalModules(ctx, companion.instanceId);
  const declared = new Set(
    modules.flatMap((m) => m.endpoints.filter((e) => e.protocol === "websocket").map((e) => `${m.moduleId}/${e.id}`))
  );
  return rows
    .filter((row) => row.enabled && declared.has(`${row.moduleId}/${row.endpointId}`))
    .map((row) => ({ moduleId: row.moduleId, endpointId: row.endpointId }))
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.endpointId.localeCompare(b.endpointId))
    .slice(0, MAX_BRIDGED_ENDPOINTS);
}

/**
 * Whether this deployment can bridge endpoints at all: it can mint relay
 * credentials and allocate the companion's relay hostname through the
 * maintenance API. A deployment without either offers no bridge. Whether the
 * instance's engine can use the bridge is a separate, per-engine question.
 */
export function bridgeAvailable(): boolean {
  return isRelayConfigured() && isMaintenanceConfigured();
}

/**
 * Push the instance's relay configuration to its engine again, because what
 * it bridges may have changed. Each call bumps `relaySyncVersion`, and the run
 * it schedules does nothing once a newer version exists, so an endpoint turned
 * on and then off cannot reach the engine in reverse order.
 */
export async function scheduleRelaySync(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    return;
  }
  const version = (instance.relaySyncVersion ?? 0) + 1;
  await ctx.db.patch(instanceId, { relaySyncVersion: version });
  await ctx.scheduler.runAfter(0, internal.companionRelayActions.syncEngine, { instanceId, version });
}

/**
 * `scheduleRelaySync` when the instance's companion has an endpoint turned on,
 * whether or not it may act right now. For changes that can start or stop the
 * bridge without touching endpoint rows: the companion re-paired or confirmed,
 * its approver's role changed, the engine registered again.
 */
export async function resyncRelayIfBridging(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const companion = await instanceCompanion(ctx, instanceId);
  if (companion && (await companionEndpointRows(ctx, companion._id)).some((row) => row.enabled)) {
    await scheduleRelaySync(ctx, instanceId);
  }
}
