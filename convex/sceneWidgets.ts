import { getAuthUserId } from "@convex-dev/auth/server";
import {
  type AlertStepSource,
  type AlertTargetUse,
  alertTargetUses,
  alertWidgetNamesAcross,
} from "@shared/alert-widgets";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type QueryCtx, query } from "./_generated/server";
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

async function alertWidgetIdsOf(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Set<string>> {
  const defs = await instanceWidgetDefinitions(ctx, instanceId);
  return new Set(defs.filter((def) => def.hostsSurface === "alert").map((def) => def.widgetId));
}

// Every name an alert widget answers to across the instance's scenes, for the
// Alert action's target picker. Only names some scene has are offered, so a step
// cannot pick a target nothing will play on.
export const alertWidgetNames = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[]> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return [];
    }

    const alertWidgetIds = await alertWidgetIdsOf(ctx, instanceId);
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    return alertWidgetNamesAcross(
      scenes.map((scene) => scene.widgets ?? []),
      alertWidgetIds
    );
  },
});

export interface AlertTargetUsage {
  /** The canonical ids of the widgets that host alerts, so the editor can tell its own alert widgets apart. */
  alertWidgetIds: string[];
  /** Names the alert widgets of every scene but the one asked about answer to. */
  elsewhere: string[];
  /** Every Alert step's target, in workflows and chat commands. */
  uses: AlertTargetUse[];
}

// What the scene editor needs to warn that an edit leaves Alert steps with no
// alert widget to play on (see `orphanedAlertTargets`). The scene being edited
// is left out of `elsewhere`, since the editor knows its names better than
// this cache: it holds the draft.
export const alertTargetUsage = query({
  args: { instanceId: v.id("instances"), engineSceneId: v.string() },
  handler: async (ctx, { instanceId, engineSceneId }): Promise<AlertTargetUsage | null> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }

    const alertWidgetIds = await alertWidgetIdsOf(ctx, instanceId);
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const elsewhere = alertWidgetNamesAcross(
      scenes.filter((scene) => scene.engineSceneId !== engineSceneId).map((scene) => scene.widgets ?? []),
      alertWidgetIds
    );

    const sources: AlertStepSource[] = [];
    const workflows = await ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const workflow of workflows) {
      const definition = workflow.definition as { name?: unknown; tasks?: unknown } | null;
      sources.push({
        kind: "workflow",
        name: typeof definition?.name === "string" && definition.name ? definition.name : workflow.engineWorkflowId,
        steps: Array.isArray(definition?.tasks) ? definition.tasks : [],
      });
    }
    const commands = await ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const command of commands) {
      sources.push({ kind: "command", name: `!${command.command}`, steps: command.actions });
    }

    return { alertWidgetIds: Array.from(alertWidgetIds), elsewhere, uses: alertTargetUses(sources) };
  },
});
