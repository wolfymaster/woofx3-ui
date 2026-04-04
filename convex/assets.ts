import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  generateConvexUploadIntent,
  generateR2UploadIntent,
  generateLocalUploadIntent,
  resolveConvexUrl,
  resolveR2Url,
  resolveLocalUrl,
  deleteConvexFile,
  deleteR2File,
  resolveProvider,
  type StorageProvider,
  type UploadIntent,
} from "./lib/storage";

// ---------------------------------------------------------------------------
// Convex-only upload URL — kept for internal uses (e.g., module archive uploads)
// that always target Convex storage regardless of the instance storage provider.
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// Upload intent — single public entry point for all storage providers
// ---------------------------------------------------------------------------

/**
 * Generate an upload intent for the active storage provider.
 * The client uses the returned UploadIntent to upload the file directly to the
 * appropriate backend, then calls assets.create() with the fileKey.
 */
export const generateUploadIntent = action({
  args: {
    instanceId: v.id("instances"),
    fileName: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args): Promise<UploadIntent> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Look up the instance to check for a per-instance provider override
    const instance = await ctx.runQuery(internal.assets._getInstanceForStorage, {
      instanceId: args.instanceId,
    });
    const provider = resolveProvider(
      (instance?.storageProvider as StorageProvider | undefined) ?? null
    );

    switch (provider) {
      case "convex":
        // Convex upload URL generation requires mutation context — delegate
        return ctx.runMutation(internal.assets._generateConvexIntent, {});

      case "r2":
        return generateR2UploadIntent(args.instanceId, args.fileName);

      case "local":
        return generateLocalUploadIntent(args.instanceId, args.fileName);
    }
  },
});

/** @internal — called by generateUploadIntent to produce a Convex upload URL */
export const _generateConvexIntent = internalMutation({
  args: {},
  handler: async (ctx): Promise<UploadIntent> => {
    return generateConvexUploadIntent(ctx);
  },
});

/** @internal — reads instance storage provider preference (no auth check needed; action checks auth) */
export const _getInstanceForStorage = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.instanceId);
  },
});

// ---------------------------------------------------------------------------
// Create asset record after upload completes
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    type: v.union(v.literal("image"), v.literal("audio"), v.literal("video")),
    fileKey: v.string(),
    storageProvider: v.union(v.literal("convex"), v.literal("r2"), v.literal("local")),
    mimeType: v.string(),
    size: v.number(),
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return ctx.db.insert("assets", {
      instanceId: args.instanceId,
      name: args.name,
      type: args.type,
      fileKey: args.fileKey,
      storageProvider: args.storageProvider,
      mimeType: args.mimeType,
      size: args.size,
      folderId: args.folderId,
      createdAt: Date.now(),
      createdBy: userId,
    });
  },
});

// ---------------------------------------------------------------------------
// List assets (with resolved URLs)
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    instanceId: v.id("instances"),
    type: v.optional(v.union(v.literal("image"), v.literal("audio"), v.literal("video"))),
    // null = root assets only; omit = all assets regardless of folder
    folderId: v.optional(v.union(v.id("folders"), v.null())),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .collect();

    let filtered = assets;

    if (args.type) {
      filtered = filtered.filter((a) => a.type === args.type);
    }

    // When folderId is explicitly provided (including null for root), filter by folder
    if ("folderId" in args) {
      filtered = filtered.filter((a) => (a.folderId ?? null) === (args.folderId ?? null));
    }

    return Promise.all(
      filtered.map(async (asset) => {
        const url = await resolveAssetUrl(ctx, asset);
        return { ...asset, url };
      })
    );
  },
});

/** Resolve the URL for an asset, handling both legacy (storageId) and new (fileKey) records. */
async function resolveAssetUrl(
  ctx: Parameters<typeof resolveConvexUrl>[0],
  asset: {
    storageProvider?: StorageProvider | null;
    fileKey?: string | null;
    storageId?: string | null;
  }
): Promise<string | null> {
  // Determine effective key and provider (dual-read: supports pre-migration records)
  const fileKey = asset.fileKey ?? asset.storageId ?? null;
  const provider = asset.storageProvider ?? (asset.storageId ? "convex" : null);

  if (!fileKey || !provider) return null;

  switch (provider) {
    case "convex":
      return resolveConvexUrl(ctx, fileKey);
    case "r2":
      return resolveR2Url(fileKey);
    case "local":
      return resolveLocalUrl(fileKey);
  }
}

// ---------------------------------------------------------------------------
// Move asset to a different folder
// ---------------------------------------------------------------------------

export const move = mutation({
  args: {
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    await ctx.db.patch(args.assetId, { folderId: args.folderId });
  },
});

// ---------------------------------------------------------------------------
// Remove asset
// ---------------------------------------------------------------------------

export const remove = mutation({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    // Delete DB record immediately
    await ctx.db.delete(args.assetId);

    // Determine effective key and provider (dual-read for pre-migration records)
    const fileKey = asset.fileKey ?? asset.storageId?.toString() ?? null;
    const provider = asset.storageProvider ?? (asset.storageId ? "convex" : null);

    if (!fileKey || !provider) return;

    if (provider === "convex") {
      // Synchronous deletion — ctx.storage available in mutation context
      await deleteConvexFile(ctx, fileKey);
    } else {
      // R2 and local deletion require fetch() — schedule as an internal action
      await ctx.scheduler.runAfter(0, internal.assets._deleteStorageFile, {
        fileKey,
        provider,
      });
    }
  },
});

/** @internal — deletes files from R2 or local storage backend */
export const _deleteStorageFile = internalAction({
  args: {
    fileKey: v.string(),
    provider: v.union(v.literal("r2"), v.literal("local")),
  },
  handler: async (_ctx, args) => {
    if (args.provider === "r2") {
      await deleteR2File(args.fileKey);
    } else {
      // Local: HTTP DELETE to the local storage server
      const localUrl = process.env.LOCAL_STORAGE_URL;
      if (!localUrl) {
        console.error("LOCAL_STORAGE_URL not set; cannot delete local file:", args.fileKey);
        return;
      }
      const res = await fetch(
        `${localUrl.replace(/\/$/, "")}/storage/files/${args.fileKey}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Local storage DELETE failed: ${res.status}`);
      }
    }
  },
});
