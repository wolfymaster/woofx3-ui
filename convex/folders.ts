import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** List folders at a given level. Omit parentId to list root folders. */
export const list = query({
  args: {
    instanceId: v.id("instances"),
    parentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("folders")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();
    return all.filter((f) => f.parentId === args.parentId);
  },
});

/** List all folders for an instance (used for move pickers and breadcrumb resolution). */
export const listAll = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("folders")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    parentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return ctx.db.insert("folders", {
      instanceId: args.instanceId,
      name: args.name,
      parentId: args.parentId,
      createdAt: Date.now(),
      createdBy: userId,
    });
  },
});

export const rename = mutation({
  args: {
    folderId: v.id("folders"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.folderId, { name: args.name });
  },
});

/** Delete a folder, promoting its contents (assets + child folders) to the parent level. */
export const remove = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found");

    // Move assets in this folder up to the parent
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_instance", (q) => q.eq("instanceId", folder.instanceId))
      .collect();

    for (const asset of assets) {
      if (asset.folderId === args.folderId) {
        await ctx.db.patch(asset._id, { folderId: folder.parentId });
      }
    }

    // Move child folders up to the parent
    const childFolders = await ctx.db
      .query("folders")
      .withIndex("by_instance", (q) => q.eq("instanceId", folder.instanceId))
      .collect();

    for (const child of childFolders) {
      if (child.parentId === args.folderId) {
        await ctx.db.patch(child._id, { parentId: folder.parentId });
      }
    }

    await ctx.db.delete(args.folderId);
  },
});
