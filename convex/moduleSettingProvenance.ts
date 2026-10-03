import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

/**
 * Who wrote the module settings that local[] endpoints name: the companion or
 * the streamer. Module settings live in the engine, so this is Convex's own
 * record of it. Read through companionIntegrations.forModule and forCompanion.
 */

async function rowFor(ctx: MutationCtx, instanceId: Id<"instances">, moduleId: string, key: string) {
  return ctx.db
    .query("moduleSettingProvenance")
    .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleId", moduleId).eq("key", key))
    .first();
}

/**
 * Records the settings the companion just wrote. A key the streamer saved by
 * hand while the companion's write was in flight stays manual: the next
 * manual save always wins, and the companion stops reporting the key.
 */
export const recordCompanionWrites = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    writes: v.array(v.object({ key: v.string(), companionValue: v.optional(v.string()) })),
  },
  returns: v.null(),
  handler: async (ctx, { instanceId, moduleId, writes }) => {
    const now = Date.now();
    for (const write of writes) {
      const existing = await rowFor(ctx, instanceId, moduleId, write.key);
      if (existing?.source === "manual") {
        continue;
      }
      const fields = {
        instanceId,
        moduleId,
        key: write.key,
        source: "companion" as const,
        companionValue: write.companionValue,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.replace(existing._id, fields);
      } else {
        await ctx.db.insert("moduleSettingProvenance", fields);
      }
    }
    return null;
  },
});

/** The streamer saved a local[] setting by hand, so the companion leaves it alone from now on. */
export const markManual = internalMutation({
  args: { instanceId: v.id("instances"), moduleId: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { instanceId, moduleId, key }) => {
    const existing = await rowFor(ctx, instanceId, moduleId, key);
    const fields = { instanceId, moduleId, key, source: "manual" as const, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.replace(existing._id, fields);
    } else {
      await ctx.db.insert("moduleSettingProvenance", fields);
    }
    return null;
  },
});

/**
 * Hand a setting back to the companion. The row goes, so the setting reads as
 * never touched, and the companion fills it on its next report; it reports
 * again when `forCompanion`'s `manualKeys` changes.
 */
export const useCompanionValue = mutation({
  args: { instanceId: v.id("instances"), moduleId: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { instanceId, moduleId, key }) => {
    await requireInstanceRole(ctx, instanceId);
    const existing = await rowFor(ctx, instanceId, moduleId, key);
    if (existing?.source === "manual") {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
