import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";

// Chat commands are engine-authoritative (see docs/services/commands-ui.md in
// the woofx3 engine repo). This table is a read cache populated by
// convex/chatCommandActions.ts (immediately, from the RPC's own response) and
// by the command.* webhooks / the periodic engine-sync "commands" step (for
// changes made elsewhere). There are intentionally NO public create/update/
// delete mutations here — writes go through chatCommandActions.ts → engine RPC.

async function membershipFor(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<Doc<"instanceMembers"> | null> {
  return await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

/**
 * List all chat commands for an instance.
 */
export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    return ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(500);
  },
});

/**
 * Functions exposed by installed modules, available to populate a
 * "function"-type command's dropdown. Sourced from the `moduleFunctions`
 * catalog (kept in sync by the MODULE_FUNCTION_REGISTERED/_DEREGISTERED
 * webhooks — see convex/moduleFunctions.ts), filtered to functions actually
 * enabled for this instance via the `instanceFunctions` join.
 */
export const listAvailableFunctions = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    const enabled = await ctx.db
      .query("instanceFunctions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const enabledIds = new Set(enabled.map((r) => r.functionId));

    const all = await ctx.db.query("moduleFunctions").collect();
    return all
      .filter((fn) => enabledIds.has(fn.engineFunctionId))
      .map((fn) => ({
        id: fn.engineFunctionId,
        moduleId: fn.moduleId,
        moduleName: fn.moduleName,
        manifestId: fn.manifestId ?? fn.engineFunctionId,
        name: fn.functionName,
        qualifiedName: fn.qualifiedName,
        runtime: fn.runtime,
      }));
  },
});

// Populated by convex/chatCommandActions.ts (own RPC response) and the
// command.created / command.updated webhooks. Keyed on engineCommandId via
// the by_engine_command_id index, so redelivery is idempotent.
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineCommandId: v.string(),
    command: v.string(),
    type: v.union(v.literal("text"), v.literal("function")),
    typeValue: v.string(),
    cooldown: v.number(),
    priority: v.number(),
    enabled: v.boolean(),
    visibility: v.union(v.literal("public"), v.literal("restricted")),
    groupIds: v.array(v.string()),
    usernames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatCommands")
      .withIndex("by_engine_command_id", (q) =>
        q.eq("instanceId", args.instanceId).eq("engineCommandId", args.engineCommandId)
      )
      .first();

    const fields = {
      applicationId: args.applicationId,
      command: args.command,
      type: args.type,
      typeValue: args.typeValue,
      cooldown: args.cooldown,
      priority: args.priority,
      enabled: args.enabled,
      visibility: args.visibility,
      groupIds: args.groupIds,
      usernames: args.usernames,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("chatCommands", {
        instanceId: args.instanceId,
        engineCommandId: args.engineCommandId,
        ...fields,
        createdAt: Date.now(),
      });
    }
  },
});

// Populated by convex/chatCommandActions.ts and the command.deleted webhook.
export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineCommandId: v.string(),
  },
  handler: async (ctx, { instanceId, engineCommandId }) => {
    const existing = await ctx.db
      .query("chatCommands")
      .withIndex("by_engine_command_id", (q) => q.eq("instanceId", instanceId).eq("engineCommandId", engineCommandId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
