import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

type DashboardPanel = NonNullable<Doc<"dashboardLayouts">["panels"]>[number];

// Returns the dashboard canvas panels for this instance, in order. Empty
// array means the user hasn't created a panel yet (canvas shows the layout
// picker).
export const getPanels = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<DashboardPanel[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    const panels = existing?.panels ?? [];
    const newPanel: DashboardPanel = {
      id: crypto.randomUUID(),
      name: args.name ?? `Panel ${panels.length + 1}`,
      layoutId: args.layoutId,
      widgets: [],
    };
    const nextPanels = [...panels, newPanel];

    if (existing) {
      await ctx.db.patch(existing._id, { panels: nextPanels });
    } else {
      await ctx.db.insert("dashboardLayouts", { instanceId: args.instanceId, userId, panels: nextPanels });
    }

    return newPanel.id;
  },
});

export const removePanel = mutation({
  args: {
    instanceId: v.id("instances"),
    panelId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      return;
    }

    const nextPanels = (existing.panels ?? []).filter((panel) => panel.id !== args.panelId);
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new Error("Name cannot be empty");
    }

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      throw new Error("Dashboard not found");
    }

    const panels = existing.panels ?? [];
    const panelIndex = panels.findIndex((panel) => panel.id === args.panelId);
    if (panelIndex === -1) {
      throw new Error("Panel not found");
    }

    const nextPanels = [...panels];
    nextPanels[panelIndex] = { ...panels[panelIndex], name: trimmedName };
    await ctx.db.patch(existing._id, { panels: nextPanels });
  },
});

// Replaces a panel's whole widgets array in one write. The client edits
// widget placement in local draft state while `isEditing` is on (so Cancel
// is just discarding that draft, no server round-trip) and calls this once
// per changed panel when Save is clicked.
export const setPanelWidgets = mutation({
  args: {
    instanceId: v.id("instances"),
    panelId: v.string(),
    widgets: v.array(
      v.object({
        zoneId: v.string(),
        type: v.string(),
        config: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();
    if (!existing) {
      throw new Error("Dashboard not found");
    }

    const panels = existing.panels ?? [];
    const panelIndex = panels.findIndex((panel) => panel.id === args.panelId);
    if (panelIndex === -1) {
      throw new Error("Panel not found");
    }

    const nextPanels = [...panels];
    nextPanels[panelIndex] = { ...panels[panelIndex], widgets: args.widgets };
    await ctx.db.patch(existing._id, { panels: nextPanels });
  },
});
