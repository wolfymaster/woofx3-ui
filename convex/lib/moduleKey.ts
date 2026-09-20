import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The bare module key — the first segment of an installed module's versioned key.
 *
 * `moduleRepository.moduleKey` records the key a module was installed under, version
 * and content hash included (`woofx3_twitch:0.1.1:eb5e20f`). Engine records that
 * belong to a module name it by its bare key instead (`createdByRef: "woofx3_twitch"`),
 * because a trigger keeps working across module upgrades.
 */
export function bareModuleKey(moduleKey: string | undefined): string | undefined {
  return moduleKey?.split(":")[0] || undefined;
}

/**
 * Bare module key → installed module, for resolving an engine record's `createdByRef`.
 *
 * An exact `by_module_key` index lookup on `createdByRef` never matches, because the
 * stored key carries a version suffix the engine does not send — which left `moduleId`
 * unset on every module-provided trigger, action and widget, so the workflow builder
 * could not attribute a field to its module, and resource_ref pickers had no module to
 * create instances against. Built once per reconcile pass rather than per record: the
 * table holds one row per installed module per instance.
 *
 * Scoped to one instance because moduleRepository rows are per-tenant and a module's
 * key is shared by every tenant that installed it — an unscoped read would attribute
 * one tenant's triggers to whichever tenant's row happened to come first.
 */
export async function loadModuleIdsByBareKey(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<Map<string, Id<"moduleRepository">>> {
  const modules = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(500);
  const byKey = new Map<string, Id<"moduleRepository">>();
  for (const module of modules) {
    const key = bareModuleKey(module.moduleKey);
    if (!key) {
      continue;
    }
    // An upgrade can leave the superseded row behind; the installed one wins.
    if (!byKey.has(key) || module.status === "installed") {
      byKey.set(key, module._id);
    }
  }
  return byKey;
}

/** Resolves one engine record's owning module. Prefer the map loader in a loop. */
export async function resolveModuleIdByRef(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  createdByType: string | undefined,
  createdByRef: string | undefined
): Promise<Id<"moduleRepository"> | undefined> {
  if (createdByType !== "MODULE" || !createdByRef) {
    return undefined;
  }
  return (await loadModuleIdsByBareKey(ctx, instanceId)).get(bareModuleKey(createdByRef) ?? createdByRef);
}

/** What `findModuleRow` needs of a `moduleRepository` row. */
export interface ModuleRowIdentity {
  _id: string;
  moduleKey?: string;
  name: string;
  version: string;
}

/** What `findModuleRow` needs of an engine module snapshot. */
export interface ModuleSnapshotIdentity {
  name: string;
  version: string;
  moduleId: string;
  moduleKey: string;
}

/**
 * The `moduleRepository` row an engine module snapshot belongs to.
 *
 * Three tiers, narrowest first. `moduleKey` carries version and content hash
 * (`woofx3:0.7.0:dcbcc35`), so an upgraded module no longer matches the key
 * its row was written under; the bare key is what survives a version bump.
 * name+version is the last resort, for a row that predates moduleKey entirely.
 *
 * `claimed` holds the ids already matched in this pass, so two snapshots can
 * never collapse onto one row — without it, two versions of a module present
 * at once would both fall through to the same bare-key match and the second
 * would overwrite the first instead of inserting.
 */
export function findModuleRow<T extends ModuleRowIdentity>(
  rows: readonly T[],
  snap: ModuleSnapshotIdentity,
  claimed: ReadonlySet<string>
): T | undefined {
  const free = rows.filter((row) => !claimed.has(row._id));
  const exact = snap.moduleKey ? free.find((row) => row.moduleKey === snap.moduleKey) : undefined;
  if (exact) {
    return exact;
  }
  const bare = bareModuleKey(snap.moduleKey) ?? snap.moduleId;
  const byBare = bare ? free.find((row) => bareModuleKey(row.moduleKey) === bare) : undefined;
  if (byBare) {
    return byBare;
  }
  return free.find((row) => row.name === snap.name && row.version === snap.version);
}
