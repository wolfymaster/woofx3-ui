import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";
import { macroActionTypeValidator, macroConfigValidator } from "./schema";

// A pad is a hand-built set of buttons; this is a sanity ceiling, not a product
// limit, so reads stay bounded as the table grows.
const MAX_MACROS = 200;

/** The shape the widget consumes — Convex's `_id` surfaced as `id`. */
function toMacroButton(row: Doc<"macros">) {
  return {
    id: row._id,
    label: row.label,
    icon: row.icon,
    color: row.color,
    type: row.type,
    config: row.config,
  };
}

async function requireMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const membership = await getInstanceMembership(ctx, instanceId, userId);
  if (!membership) {
    throw new Error("Not a member of this instance");
  }
  return userId;
}

/** The macro belongs to this instance — guards against an id from another tenant. */
async function requireMacro(ctx: MutationCtx, instanceId: Id<"instances">, macroId: Id<"macros">) {
  const macro = await ctx.db.get(macroId);
  if (!macro || macro.instanceId !== instanceId) {
    throw new Error("Macro not found");
  }
  return macro;
}

export const list = query({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args) => {
    // An unauthenticated or non-member caller sees an empty pad rather than an
    // error, matching dashboardLayouts.getPanels — the widget renders its empty
    // state instead of tearing down the dashboard.
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, args.instanceId, userId);
    if (!membership) {
      return [];
    }

    const rows = await ctx.db
      .query("macros")
      .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", args.instanceId))
      .take(MAX_MACROS);

    return rows.map(toMacroButton);
  },
});

export const addMacro = mutation({
  args: {
    instanceId: v.id("instances"),
    label: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    type: macroActionTypeValidator,
    config: macroConfigValidator,
  },
  handler: async (ctx, args): Promise<Id<"macros">> => {
    await requireMember(ctx, args.instanceId);

    const last = await ctx.db
      .query("macros")
      .withIndex("by_instance_and_sort_order", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .first();

    return ctx.db.insert("macros", {
      instanceId: args.instanceId,
      label: args.label,
      icon: args.icon,
      color: args.color,
      type: args.type,
      config: args.config,
      sortOrder: last ? last.sortOrder + 1 : 0,
      updatedAt: Date.now(),
    });
  },
});

export const updateMacro = mutation({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
    label: v.string(),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    type: macroActionTypeValidator,
    config: macroConfigValidator,
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);
    await requireMacro(ctx, args.instanceId, args.macroId);

    // icon and color are cleared by omission, so they are patched explicitly
    // rather than spread — a button losing its color must actually persist.
    await ctx.db.patch(args.macroId, {
      label: args.label,
      icon: args.icon,
      color: args.color,
      type: args.type,
      config: args.config,
      updatedAt: Date.now(),
    });
  },
});

export const deleteMacro = mutation({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);
    await requireMacro(ctx, args.instanceId, args.macroId);
    await ctx.db.delete(args.macroId);
  },
});

export const reorderMacros = mutation({
  args: {
    instanceId: v.id("instances"),
    macroIds: v.array(v.id("macros")),
  },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.instanceId);

    // Only rows whose position actually changed are written. A macro deleted by
    // someone else between the drag and this call is skipped rather than failing
    // the whole reorder.
    for (let index = 0; index < args.macroIds.length; index++) {
      const macro = await ctx.db.get(args.macroIds[index]);
      if (!macro || macro.instanceId !== args.instanceId) {
        continue;
      }
      if (macro.sortOrder !== index) {
        await ctx.db.patch(macro._id, { sortOrder: index, updatedAt: Date.now() });
      }
    }
  },
});
