import { parseEngineCapabilities } from "@woofx3/api/capabilities";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { isInstanceMember } from "./lib/teamAccess";
import { requireInstanceContext } from "./sceneActions";

// One stored answer per instance to "which capabilities does its engine
// advertise", so capability gates cost no engine call of their own. See the
// engineCapabilities table in schema.ts for who writes it and when.

async function readCapabilities(ctx: QueryCtx, instanceId: Id<"instances">): Promise<string[] | null> {
  const row = await ctx.db
    .query("engineCapabilities")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  return row?.capabilities ?? null;
}

async function storeCapabilities(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  capabilities: string[],
  fetchedAt: number
): Promise<void> {
  const existing = await ctx.db
    .query("engineCapabilities")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { capabilities, fetchedAt });
    return;
  }
  await ctx.db.insert("engineCapabilities", { instanceId, capabilities, fetchedAt });
}

export const store = internalMutation({
  args: { instanceId: v.id("instances"), capabilities: v.array(v.string()), fetchedAt: v.number() },
  handler: async (ctx, { instanceId, capabilities, fetchedAt }) =>
    storeCapabilities(ctx, instanceId, capabilities, fetchedAt),
});

/** The stored capabilities, for server-side steps; null when the engine has not reported yet. */
export const forInstance = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[] | null> => readCapabilities(ctx, instanceId),
});

/**
 * What the instance's engine advertises. Null when the caller cannot see the
 * instance or the engine has not reported yet, which a gate reads as "not
 * available".
 */
export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[] | null> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    return readCapabilities(ctx, instanceId);
  },
});

/** Asks the engine again and stores the answer. */
export const refresh = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<string[]> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const { capabilities } = parseEngineCapabilities(
      await createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret).getEngineCapabilities()
    );
    await ctx.runMutation(internal.engineCapabilities.store, { instanceId, capabilities, fetchedAt: Date.now() });
    return capabilities;
  },
});
