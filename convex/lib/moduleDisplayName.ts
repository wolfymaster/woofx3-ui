import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The group a definition belongs to when it names no module: the widgets and
 * actions the engine itself provides.
 */
export const BUILTIN_MODULE_LABEL = "Built-in";

/**
 * Each distinct moduleId's `moduleRepository.name` — the human display name, e.g.
 * "Counter" — for catalogs that group what they offer by the module providing it.
 *
 * A different derivation than workflowCatalog.ts's `resolveModuleNames`, which
 * resolves to the engine-facing moduleKey segment for RPC calls, not display.
 */
export async function resolveModuleDisplayNames(
  ctx: QueryCtx,
  moduleIds: (Id<"moduleRepository"> | undefined)[]
): Promise<Map<Id<"moduleRepository">, string>> {
  const uniqueIds = Array.from(new Set(moduleIds.filter((id): id is Id<"moduleRepository"> => id !== undefined)));
  const names = new Map<Id<"moduleRepository">, string>();
  for (const moduleId of uniqueIds) {
    const module = await ctx.db.get(moduleId);
    if (module) {
      names.set(moduleId, module.name);
    }
  }
  return names;
}
