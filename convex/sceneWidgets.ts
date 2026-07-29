import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";

export type SceneWidgetCatalogRow = Doc<"moduleWidgets"> & { moduleName: string };

// Built-in widgets (createdByType "SYSTEM", e.g. media_alert) have no moduleId —
// see docs/ui/scenes.md "Widget System" for how they arrive via the engine's
// startup webhook rather than a module install.
const BUILTIN_GROUP_LABEL = "Built-in";

// Resolves each distinct moduleId to its moduleRepository.name (the human display
// name, e.g. "Counter") for grouping the widget catalog sidebar by module — a
// different derivation than workflowCatalog.ts's resolveModuleNames, which
// resolves to the engine-facing moduleKey segment for RPC calls, not display.
async function resolveModuleDisplayNames(
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

// Instance-scoped widget catalog for the scene editor's widget sidebar. Mirrors the
// workflow catalog pattern: read the per-instance `instanceWidgets` join, then
// look up each widget's definition in the global `moduleWidgets` catalog. The
// query only ever filters by instanceId — widgets are never gated on a module.
export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SceneWidgetCatalogRow[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .first();
    if (!membership) {
      return [];
    }

    const rows = await ctx.db
      .query("instanceWidgets")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const defs: Doc<"moduleWidgets">[] = [];
    for (const row of rows) {
      const def = await ctx.db
        .query("moduleWidgets")
        .withIndex("by_widget_id", (q) => q.eq("widgetId", row.widgetId))
        .first();
      if (def) {
        defs.push(def);
      }
    }

    const moduleNames = await resolveModuleDisplayNames(
      ctx,
      defs.map((def) => def.moduleId)
    );

    return defs.map((def) => ({
      ...def,
      moduleName: (def.moduleId ? moduleNames.get(def.moduleId) : undefined) ?? BUILTIN_GROUP_LABEL,
    }));
  },
});
