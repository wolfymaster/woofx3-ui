import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
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

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
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
    const { instanceId, ...moduleData } = args;
    const moduleId = await ctx.db.insert("moduleRepository", {
      ...moduleData,
      instanceId,
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      moduleId,
      instanceId,
    });
    return moduleId;
  },
});

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
    await ctx.db.patch(args.moduleId, { status: "pending", statusMessage: undefined });
    await ctx.scheduler.runAfter(0, internal.moduleEngine.deliverZipToInstance, {
      moduleId: args.moduleId,
      instanceId: args.instanceId,
    });
    return { enqueued: true };
  },
});

export const updateStatus = internalMutation({
  args: {
    moduleId: v.id("moduleRepository"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivering"),
      v.literal("installed"),
      v.literal("failed"),
    ),
    statusMessage: v.optional(v.string()),
  },
  handler: async (ctx, { moduleId, status, statusMessage }) => {
    const existing = await ctx.db.get(moduleId);
    if (!existing) {
      return;
    }
    await ctx.db.patch(moduleId, {
      status,
      statusMessage: status === "failed" ? statusMessage : undefined,
    });
  },
});

export const getInstallDeliveryData = internalQuery({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }
    const module = await ctx.db.get(args.moduleId);
    if (!module) {
      throw new Error("Module not found");
    }
    const archiveUrl = await ctx.storage.getUrl(module.archiveKey as Id<"_storage">);
    if (!archiveUrl) {
      throw new Error("Module archive not found");
    }
    return {
      instanceUrl: instance.url,
      apiKey: instance.apiKey ?? null,
      applicationId: instance.applicationId ?? null,
      archiveUrl,
      fileName: `${module.name}-${module.version}.zip`,
    };
  },
});
