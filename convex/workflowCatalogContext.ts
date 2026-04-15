import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";

async function assertInstanceMember(ctx: QueryCtx, userId: Id<"users">, instanceId: Id<"instances">) {
  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return membership ?? null;
}

export type CatalogBundle = {
  url: string;
  clientId: string | null;
  clientSecret: string | null;
  enabledTriggerIds: string[];
  enabledActionIds: string[];
  triggerDefs: Record<string, Doc<"triggerDefinitions">>;
  actionDefs: Record<string, Doc<"actionDefinitions">>;
};

export async function loadCatalogBundle(
  ctx: QueryCtx,
  userId: Id<"users">,
  instanceId: Id<"instances">
): Promise<CatalogBundle | null> {
  const membership = await assertInstanceMember(ctx, userId, instanceId);
  if (!membership) {
    return null;
  }

  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    return null;
  }

  const enabledTriggerRows = await ctx.db
    .query("instanceEnabledTriggers")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();

  const enabledActionRows = await ctx.db
    .query("instanceEnabledActions")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();

  const enabledTriggerIds = enabledTriggerRows.map((r) => r.triggerId);
  const enabledActionIds = enabledActionRows.map((r) => r.actionId);

  const triggerDefs: Record<string, Doc<"triggerDefinitions">> = {};
  for (const tid of enabledTriggerIds) {
    const def = await ctx.db
      .query("triggerDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", tid))
      .first();
    if (def) {
      triggerDefs[tid] = def;
    }
  }

  const actionDefs: Record<string, Doc<"actionDefinitions">> = {};
  for (const aid of enabledActionIds) {
    const def = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_slug", (q) => q.eq("slug", aid))
      .first();
    if (def) {
      actionDefs[aid] = def;
    }
  }

  return {
    url: instance.url,
    clientId: instance.clientId ?? null,
    clientSecret: instance.clientSecret ?? null,
    enabledTriggerIds,
    enabledActionIds,
    triggerDefs,
    actionDefs,
  };
}

export const catalogContextForUser = internalQuery({
  args: {
    instanceId: v.id("instances"),
    userId: v.id("users"),
  },
  handler: async (ctx, { instanceId, userId }) => {
    return loadCatalogBundle(ctx, userId, instanceId);
  },
});
