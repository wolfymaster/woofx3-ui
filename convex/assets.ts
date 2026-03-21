import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    type: v.union(v.literal("image"), v.literal("audio"), v.literal("video")),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return ctx.db.insert("assets", {
      ...args,
      createdAt: Date.now(),
      createdBy: userId,
    });
  },
});

export const list = query({
  args: {
    instanceId: v.id("instances"),
    type: v.optional(v.union(v.literal("image"), v.literal("audio"), v.literal("video"))),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("assets").withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId));

    const assets = await q.order("desc").collect();

    // Filter by type if specified
    const filtered = args.type ? assets.filter((a) => a.type === args.type) : assets;

    // Attach signed URLs
    return Promise.all(
      filtered.map(async (asset) => ({
        ...asset,
        url: await ctx.storage.getUrl(asset.storageId),
      }))
    );
  },
});

export const remove = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(args.assetId);
  },
});
