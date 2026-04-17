import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const list = query({
  args: {
    search: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("moduleRepository").collect();

    let results = all;

    if (args.tags && args.tags.length > 0) {
      results = results.filter((m) => args.tags!.some((tag) => m.tags.includes(tag)));
    }

    if (args.search) {
      const lower = args.search.toLowerCase();
      results = results.filter(
        (m) => m.name.toLowerCase().includes(lower) || m.description.toLowerCase().includes(lower)
      );
    }

    return results;
  },
});

export const get = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.moduleId);
  },
});

/**
 * Upload the zip to storage and deliver it to the engine.
 * No moduleRepository record is created — that only happens on successful install
 * via the webhook callback. Errors are communicated via transientEvents.
 */
export const uploadAndDeliver = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    name: v.string(),
    description: v.string(),
    version: v.string(),
    tags: v.array(v.string()),
    manifest: v.any(),
    archiveKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      instanceId: args.instanceId,
      moduleKey: args.moduleKey,
      archiveKey: args.archiveKey,
      fileName: `${args.name}-${args.version}.zip`,
      moduleMeta: {
        name: args.name,
        description: args.description,
        version: args.version,
        tags: args.tags,
        manifest: args.manifest,
      },
    });
    return { delivered: true };
  },
});

/**
 * Re-deliver an existing module record's archive to the engine.
 */
export const enqueueEngineInstall = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const module = await ctx.db.get(args.moduleId);
    if (!module) {
      throw new Error("Module not found");
    }
    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      instanceId: args.instanceId,
      moduleKey: module.moduleKey ?? `${module.name}:${module.version}:unknown`,
      archiveKey: module.archiveKey,
      fileName: `${module.name}-${module.version}.zip`,
      moduleMeta: {
        name: module.name,
        description: module.description,
        version: module.version,
        tags: module.tags,
        manifest: module.manifest,
      },
    });
    return { enqueued: true };
  },
});

/**
 * Internal-only: cascade-delete a moduleRepository record, its archive blob,
 * and all triggerDefinitions/actionDefinitions rows that point at it.
 *
 * Called from the module.uninstalled webhook processor after the engine has
 * confirmed the uninstall. Not exposed to the UI — all user-initiated removals
 * go through the async requestModuleUninstall action.
 */
export const deleteRepositoryRecord = internalMutation({
  args: {
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const module = await ctx.db.get(args.moduleId);
    if (!module) {
      return;
    }
    if (module.archiveKey) {
      await ctx.storage.delete(module.archiveKey as Id<"_storage">);
    }

    const triggers = await ctx.db
      .query("triggerDefinitions")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
    for (const trigger of triggers) {
      await ctx.db.delete(trigger._id);
    }

    const actions = await ctx.db
      .query("actionDefinitions")
      .withIndex("by_module", (q) => q.eq("moduleId", args.moduleId))
      .collect();
    for (const action of actions) {
      await ctx.db.delete(action._id);
    }

    await ctx.db.delete(args.moduleId);
  },
});

export const getDeliveryData = internalQuery({
  args: {
    instanceId: v.id("instances"),
    archiveKey: v.string(),
  },
  handler: async (ctx, args) => {
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }
    const archiveUrl = await ctx.storage.getUrl(args.archiveKey as Id<"_storage">);
    if (!archiveUrl) {
      throw new Error("Module archive not found in storage");
    }
    return {
      instanceUrl: instance.url,
      clientId: instance.clientId ?? null,
      clientSecret: instance.clientSecret ?? null,
      archiveUrl,
    };
  },
});
