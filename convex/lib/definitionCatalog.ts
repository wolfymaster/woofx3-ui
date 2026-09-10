import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * triggerDefinitions, actionDefinitions and moduleWidgets are a single global
 * catalog keyed by stable slug: every instance that installs a module points at
 * the same row, and the row's `moduleId` records only whichever instance
 * registered it last. Per-instance enablement lives in the instance* join
 * tables, and that — not the module link — is what says a definition is still
 * in use.
 *
 * So one tenant uninstalling, upgrading, or deregistering must not delete a
 * definition another tenant still enables. These helpers apply the rule:
 * **a definition lives while any instance enables it; the last user takes it
 * down.** Call them *after* removing the caller's own join rows, so "still
 * enabled" no longer counts the caller.
 *
 * `moduleId`, when given, is a module record being deleted: a surviving
 * definition that points at it has the link cleared rather than left dangling.
 * Re-registration by any instance sets it again.
 */
export async function pruneTriggerDefinitions(ctx: MutationCtx, slugs: string[], moduleId?: Id<"moduleRepository">) {
  for (const slug of slugs) {
    const def = await ctx.db
      .query("triggerDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!def) {
      continue;
    }
    const stillEnabled = await ctx.db
      .query("instanceTriggers")
      .withIndex("by_trigger", (q) => q.eq("triggerId", slug))
      .first();
    if (!stillEnabled) {
      await ctx.db.delete(def._id);
      continue;
    }
    if (moduleId && def.moduleId === moduleId) {
      await ctx.db.patch(def._id, { moduleId: undefined });
    }
  }
}

/** See {@link pruneTriggerDefinitions}. */
export async function pruneActionDefinitions(ctx: MutationCtx, slugs: string[], moduleId?: Id<"moduleRepository">) {
  for (const slug of slugs) {
    const def = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!def) {
      continue;
    }
    const stillEnabled = await ctx.db
      .query("instanceActions")
      .withIndex("by_action", (q) => q.eq("actionId", slug))
      .first();
    if (!stillEnabled) {
      await ctx.db.delete(def._id);
      continue;
    }
    if (moduleId && def.moduleId === moduleId) {
      await ctx.db.patch(def._id, { moduleId: undefined });
    }
  }
}

/** See {@link pruneTriggerDefinitions}. Widgets key on widgetId, and their join row is a placement. */
export async function pruneWidgetDefinitions(ctx: MutationCtx, widgetIds: string[], moduleId?: Id<"moduleRepository">) {
  for (const widgetId of widgetIds) {
    const def = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", widgetId))
      .first();
    if (!def) {
      continue;
    }
    const stillPlaced = await ctx.db
      .query("instanceWidgets")
      .withIndex("by_widget", (q) => q.eq("widgetId", widgetId))
      .first();
    if (!stillPlaced) {
      await ctx.db.delete(def._id);
      continue;
    }
    if (moduleId && def.moduleId === moduleId) {
      await ctx.db.patch(def._id, { moduleId: undefined });
    }
  }
}

/** Order-preserving dedupe; drops empty ids. */
export function uniqueIds(ids: string[]): string[] {
  const unique: string[] = [];
  for (const id of ids) {
    if (id && !unique.includes(id)) {
      unique.push(id);
    }
  }
  return unique;
}
