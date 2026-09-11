import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { pruneWidgetDefinitions } from "./lib/definitionCatalog";
import { resolveModuleIdByRef } from "./lib/moduleKey";

type WidgetProvenance = {
  createdByType?: string;
  createdByRef?: string;
  projectionKey?: string;
};

// Per-instance placement enablement (mirrors enableFunctionForInstance). Upserts
// the instanceWidgets join row and backfills provenance onto an existing row.
async function enableWidgetForInstance(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  widgetId: string,
  provenance: WidgetProvenance
) {
  const existing = await ctx.db
    .query("instanceWidgets")
    .withIndex("by_instance_widget", (q) => q.eq("instanceId", instanceId).eq("widgetId", widgetId))
    .first();
  if (!existing) {
    await ctx.db.insert("instanceWidgets", {
      instanceId,
      widgetId,
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
      projectionKey: provenance.projectionKey,
    });
    return;
  }
  if (provenance.createdByRef && existing.createdByRef !== provenance.createdByRef) {
    await ctx.db.patch(existing._id, {
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
      projectionKey: provenance.projectionKey,
    });
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("moduleWidgets").collect();
  },
});

export const listByModule = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("moduleWidgets")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
  },
});

export const get = query({
  args: { widgetId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();
  },
});

export const register = mutation({
  args: {
    moduleId: v.id("moduleRepository"),
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    settings: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        directory: args.directory,
        description: args.description,
        alertTypes: args.alertTypes,
        settings: args.settings,
      });
      return existing._id;
    }

    return await ctx.db.insert("moduleWidgets", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * MODULE_WIDGET_DEREGISTERED: remove this instance's placement, then drop the
 * shared definition only if no other instance still places it. The definition
 * catalog is global, so deleting it outright took the widget away from every
 * tenant that had it — and left this instance's own placement row behind,
 * pointing at a definition that no longer existed.
 */
export const unregister = internalMutation({
  args: {
    instanceId: v.id("instances"),
    widgetId: v.string(),
  },
  handler: async (ctx, args) => {
    const placement = await ctx.db
      .query("instanceWidgets")
      .withIndex("by_instance_widget", (q) => q.eq("instanceId", args.instanceId).eq("widgetId", args.widgetId))
      .first();
    if (placement) {
      await ctx.db.delete(placement._id);
    }

    await pruneWidgetDefinitions(ctx, [args.widgetId]);
  },
});

export const registerFromWebhook = internalMutation({
  args: {
    // The delivering instance, from the MODULE_WIDGET_REGISTERED webhook. Places
    // the widget for that instance, and scopes the owning-module lookup — a
    // module's moduleKey is shared by every tenant that installed it.
    instanceId: v.id("instances"),
    widgetId: v.string(),
    name: v.string(),
    directory: v.string(),
    description: v.optional(v.string()),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
    projectionKey: v.optional(v.string()),
    alertTypes: v.array(v.string()),
    settings: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    // Resolve moduleId only for module-sourced widgets (built-ins have none).
    const moduleId = await resolveModuleIdByRef(ctx, args.instanceId, args.createdByType, args.createdByRef);

    const def = {
      moduleId,
      widgetId: args.widgetId,
      name: args.name,
      directory: args.directory,
      description: args.description,
      createdByType: args.createdByType,
      createdByRef: args.createdByRef,
      projectionKey: args.projectionKey,
      alertTypes: args.alertTypes,
      settings: args.settings,
    };

    const existing = await ctx.db
      .query("moduleWidgets")
      .withIndex("by_widget_id", (q) => q.eq("widgetId", args.widgetId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, def);
    } else {
      await ctx.db.insert("moduleWidgets", { ...def, createdAt: Date.now() });
    }

    await enableWidgetForInstance(ctx, args.instanceId, args.widgetId, {
      createdByType: args.createdByType,
      createdByRef: args.createdByRef,
      projectionKey: args.projectionKey,
    });
  },
});
