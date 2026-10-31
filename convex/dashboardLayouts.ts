import { getAuthUserId } from "@convex-dev/auth/server";
import {
  assertRailWidgets,
  addPanel as withPanelAdded,
  removePanel as withPanelRemoved,
  renamePanel as withPanelRenamed,
  setPanelWidgets as withPanelWidgets,
} from "@shared/dashboard-layout";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";
import { isInstanceMember } from "./lib/teamAccess";
import { dashboardPanelWidgetValidator, dashboardRailWidgetValidator } from "./schema";

type DashboardPanel = NonNullable<Doc<"dashboardLayouts">["panels"]>[number];
type DashboardRailWidget = NonNullable<Doc<"dashboardLayouts">["railWidgets"]>[number];

// Returns the dashboard canvas panels for this instance, in order. Empty
// array means the user hasn't created a panel yet (canvas shows the layout
// picker).
export const getPanels = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<DashboardPanel[]> => {
    const userId = await getAuthUserId(ctx);
    // Subscribed with the instance id cached from the last session before
    // membership is confirmed; a layout saved for an instance the caller has
    // since lost must not come back.
    if (!userId || !(await isInstanceMember(ctx, args.instanceId))) {
      return [];
    }

    const row = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    return row?.panels ?? [];
  },
});

export const addPanel = mutation({
  args: {
    instanceId: v.id("instances"),
    layoutId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await requireInstanceRole(ctx, args.instanceId);

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    const panelId = crypto.randomUUID();
    const nextPanels = withPanelAdded(existing?.panels ?? [], panelId, args.layoutId, args.name);

    if (existing) {
      await ctx.db.patch(existing._id, { panels: nextPanels });
    } else {
      await ctx.db.insert("dashboardLayouts", { instanceId: args.instanceId, userId, panels: nextPanels });
    }

    return panelId;
  },
});

export const removePanel = mutation({
  args: {
    instanceId: v.id("instances"),
    panelId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireInstanceRole(ctx, args.instanceId);

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      return;
    }

    const nextPanels = withPanelRemoved(existing.panels ?? [], args.panelId);
    await ctx.db.patch(existing._id, { panels: nextPanels });
  },
});

export const renamePanel = mutation({
  args: {
    instanceId: v.id("instances"),
    panelId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireInstanceRole(ctx, args.instanceId);

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      throw new Error("Dashboard not found");
    }

    const nextPanels = withPanelRenamed(existing.panels ?? [], args.panelId, args.name);
    await ctx.db.patch(existing._id, { panels: nextPanels });
  },
});

// Replaces a panel's whole widgets array in one write. The client edits
// widget placement in local draft state while `isEditing` is on (so Cancel
// is just discarding that draft, no server round-trip) and calls this once
// per changed panel when Save is clicked. A widget changing its own config
// outside edit mode (a macro added to the macro pad) writes through here
// immediately instead — there is no draft to save in that case.
export const setPanelWidgets = mutation({
  args: {
    instanceId: v.id("instances"),
    panelId: v.string(),
    widgets: v.array(dashboardPanelWidgetValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireInstanceRole(ctx, args.instanceId);

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      throw new Error("Dashboard not found");
    }

    const nextPanels = withPanelWidgets(existing.panels ?? [], args.panelId, args.widgets);
    await ctx.db.patch(existing._id, { panels: nextPanels });
  },
});

// The widgets docked to the dashboard rail. Null means the user has never
// edited the rail, and the client shows its defaults; an empty array means
// they removed every rail widget.
export const getRailWidgets = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<DashboardRailWidget[] | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await isInstanceMember(ctx, args.instanceId))) {
      return null;
    }

    const row = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    return row?.railWidgets ?? null;
  },
});

// Replaces the rail's widgets in one write: saved with the panels on Save in
// edit mode, or straight away when a rail widget changes its own config.
export const setRailWidgets = mutation({
  args: {
    instanceId: v.id("instances"),
    widgets: v.array(dashboardRailWidgetValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireInstanceRole(ctx, args.instanceId);
    assertRailWidgets(args.widgets);

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { railWidgets: args.widgets });
    } else {
      await ctx.db.insert("dashboardLayouts", { instanceId: args.instanceId, userId, railWidgets: args.widgets });
    }
  },
});
