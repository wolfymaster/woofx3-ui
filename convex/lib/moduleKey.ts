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
 * table holds one row per installed module.
 */
export async function loadModuleIdsByBareKey(ctx: QueryCtx): Promise<Map<string, Id<"moduleRepository">>> {
  const modules = await ctx.db.query("moduleRepository").take(500);
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
  createdByType: string | undefined,
  createdByRef: string | undefined
): Promise<Id<"moduleRepository"> | undefined> {
  if (createdByType !== "MODULE" || !createdByRef) {
    return undefined;
  }
  return (await loadModuleIdsByBareKey(ctx)).get(bareModuleKey(createdByRef) ?? createdByRef);
}
