import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
import { alertWidgetName, DEFAULT_ALERT_WIDGET_NAME } from "./lib/alertWidgets";
import { BUILTIN_MODULE_LABEL, resolveModuleDisplayNames } from "./lib/moduleDisplayName";

export type SceneWidgetCatalogRow = Doc<"moduleWidgets"> & { moduleName: string };

// Built-in widgets (createdByType "SYSTEM", e.g. the bundled Alert and Text
// widgets) have no moduleId — see docs/ui/scenes.md "Widget System" for how
// they arrive via the engine's startup webhook rather than a module install.

async function isInstanceMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return membership !== null;
}

// Mirrors the workflow catalog pattern: read the per-instance `instanceWidgets`
// join, then look up each widget's definition in the global `moduleWidgets`
// catalog. Only ever filters by instanceId — widgets are never gated on a module.
async function instanceWidgetDefinitions(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Doc<"moduleWidgets">[]> {
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
  return defs;
}

// Instance-scoped widget catalog for the scene editor's and the alert layout
// editor's widget sidebar.
export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<SceneWidgetCatalogRow[]> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return [];
    }

    const defs = await instanceWidgetDefinitions(ctx, instanceId);
    const moduleNames = await resolveModuleDisplayNames(
      ctx,
      defs.map((def) => def.moduleId)
    );

    return defs.map((def) => ({
      ...def,
      moduleName: (def.moduleId ? moduleNames.get(def.moduleId) : undefined) ?? BUILTIN_MODULE_LABEL,
    }));
  },
});

interface ScenePlacement {
  widgetCanonicalId?: unknown;
  settings?: Record<string, unknown>;
}

// Every name an alert widget answers to across the instance's scenes, for the
// Alert action's target picker. The default always leads the list: it is what
// an unconfigured step plays on, even before any scene has an alert widget.
export const alertWidgetNames = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[]> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return [];
    }

    const defs = await instanceWidgetDefinitions(ctx, instanceId);
    const alertWidgetIds = new Set(defs.filter((def) => def.hostsSurface === "alert").map((def) => def.widgetId));
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const names = new Set<string>();
    for (const scene of scenes) {
      for (const placement of (scene.widgets ?? []) as ScenePlacement[]) {
        if (typeof placement.widgetCanonicalId === "string" && alertWidgetIds.has(placement.widgetCanonicalId)) {
          names.add(alertWidgetName(placement.settings));
        }
      }
    }
    names.delete(DEFAULT_ALERT_WIDGET_NAME);
    return [DEFAULT_ALERT_WIDGET_NAME, ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  },
});
