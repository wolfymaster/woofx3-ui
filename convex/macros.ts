import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, type MutationCtx, mutation, type QueryCtx, query } from "./_generated/server";
import { executeMacroPlan, loadMacroEngineContext, valuesFromPairs } from "./lib/macroExecution";
import { CHAT_COMMAND_RUN_RESTRICTION, macroBehaviorFingerprint, planMacroRun } from "./lib/macroTrigger";
import { getInstanceMembership } from "./lib/teamAccess";
import { deleteTriggerForMacro, findTriggerForMacro, isInstanceManager } from "./macroTriggers";
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

/**
 * A macro with a trigger URL runs, from anywhere, whatever it is set to do, so
 * only an owner or admin may change that or delete it. Label, icon and color
 * stay open to every member.
 */
async function requireManagerIfTriggered(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  macroId: Id<"macros">,
  userId: Id<"users">,
  intent: string
): Promise<void> {
  if (!(await findTriggerForMacro(ctx, macroId))) {
    return;
  }
  if (!(await isInstanceManager(ctx, instanceId, userId))) {
    throw new Error(`This macro has a remote trigger URL, so only an owner or admin can ${intent}`);
  }
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
    const userId = await requireMember(ctx, args.instanceId);
    const macro = await requireMacro(ctx, args.instanceId, args.macroId);
    const changesBehavior =
      macroBehaviorFingerprint(args.type, args.config) !== macroBehaviorFingerprint(macro.type, macro.config);
    if (changesBehavior) {
      await requireManagerIfTriggered(ctx, args.instanceId, args.macroId, userId, "change what it does");
    }

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
    // An HTTP-request macro cannot run from a trigger URL (see planMacroRun), so
    // a URL left behind would only ever answer 422 and the editor offers no way
    // to revoke it.
    if (args.type === "http-request") {
      await deleteTriggerForMacro(ctx, args.macroId);
    }
  },
});

export const deleteMacro = mutation({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx, args.instanceId);
    await requireMacro(ctx, args.instanceId, args.macroId);
    await requireManagerIfTriggered(ctx, args.instanceId, args.macroId, userId, "delete it");
    await deleteTriggerForMacro(ctx, args.macroId);
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

export const runContext = internalQuery({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
    userId: v.id("users"),
  },
  handler: async (ctx, { instanceId, macroId, userId }) => {
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    const macro = await ctx.db.get(macroId);
    if (!macro || macro.instanceId !== instanceId) {
      return null;
    }
    const engine = await loadMacroEngineContext(ctx, instanceId);
    const isManager = membership.role === "owner" || membership.role === "admin";
    return { type: macro.type, config: macro.config, engine, isManager };
  },
});

/**
 * Run a macro from the dashboard. The remote trigger route plans and executes
 * through the same planMacroRun and executeMacroPlan, so a pad press and a
 * Stream Deck press do the same thing. HTTP-request macros are refused here:
 * the pad fetches those from the browser.
 */
export const run = action({
  args: {
    instanceId: v.id("instances"),
    macroId: v.id("macros"),
    values: v.array(v.object({ name: v.string(), value: v.string() })),
  },
  handler: async (ctx, { instanceId, macroId, values }): Promise<{ triggerId: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const context = await ctx.runQuery(internal.macros.runContext, { instanceId, macroId, userId });
    if (!context) {
      throw new Error("Macro not found");
    }
    if (!context.engine) {
      throw new Error("Instance is not registered with the engine");
    }
    const planned = planMacroRun(context.type, context.config, valuesFromPairs(values));
    if (!planned.ok) {
      throw new Error(planned.error);
    }
    // A chat-command macro runs as the broadcaster, who holds every command
    // grant; letting any member press it would hand them the broadcaster's
    // commands (a ban, a raid) regardless of their own chat permissions.
    if (planned.plan.kind === "chat-command" && !context.isManager) {
      throw new Error(CHAT_COMMAND_RUN_RESTRICTION);
    }
    const result = await executeMacroPlan(context.engine, planned.plan, "dashboard");
    return { triggerId: result.triggerId ?? null };
  },
});
