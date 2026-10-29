import { getAuthUserId } from "@convex-dev/auth/server";
import type { UploadGrant } from "@woofx3/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { type HostedStorageLimits, isOnHostedStorage } from "./lib/hostedStorage";

// User assets ("resources") are engine-authoritative. Every function here is a
// thin proxy over the engine's resource API, following the standard
// Convex→engine pattern in CLAUDE.md.
//
// These are actions rather than queries, and that is forced rather than
// chosen: a Convex query cannot reach an external service. The alternative —
// mirroring resources into a Convex table the way chatCommands and
// chatCommandGroups are mirrored — does not work here, for two reasons:
//
//  1. The engine emits no resource webhooks. Nothing tells the control plane
//     that a resource was created, renamed, moved, or deleted, so a mirror
//     would be stale the moment anything touched it from elsewhere.
//  2. Thumbnails are generated asynchronously and land on the resource later.
//     The completion callback runs barkloader→engine, never engine→Convex, so
//     a mirror would never learn a thumbnail became ready.
//
// The cost is that the assets page re-fetches after each mutation instead of
// updating reactively. That is the honest trade: a mirror would look reactive
// while silently serving stale rows.
//
// Bytes never transit Convex. Callers request a grant, PUT straight at
// storage, then report completion.

type InstanceContext = {
  url: string;
  clientId: string;
  clientSecret: string;
};

async function requireInstanceContext(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) {
    throw new Error("Not authorized or instance not found");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

/** Mirrors the engine's `Resource`. Restated rather than imported so the
 *  client has a stable shape even as the engine's own type moves. */
export type ResourceDto = {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
  kind: string;
  contentType: string;
  size: number;
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResourcesDto = {
  resources: ResourceDto[];
  total: number;
  page: number;
  pageSize: number;
};

export const list = action({
  args: {
    instanceId: v.id("instances"),
    // null lists the root; a folder id lists that folder's direct children.
    folderId: v.optional(v.union(v.string(), v.null())),
    kind: v.optional(v.string()),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PaginatedResourcesDto> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.listResources({
      folderId: args.folderId ?? null,
      kind: args.kind,
      search: args.search,
      page: args.page,
      pageSize: args.pageSize,
    });
  },
});

/**
 * Step one of an upload: reserve a resource row and get permission to PUT.
 * The grant is provider-agnostic — S3 presigned URL or the engine's own
 * token-guarded endpoint — so the browser performs one PUT with exactly the
 * returned headers and never branches on which backend is configured. The
 * grant is bound to `size`: storage refuses a body of any other length.
 *
 * On hosted storage the upload must also fit the plan's limits, held by a
 * reservation while the grant is issued (see convex/hostedStorage.ts).
 *
 * `kind: "custom_module"` uploads a module archive to install: the engine keeps
 * it out of the media library and never serves it, and its per-file limit is
 * the module archive one.
 */
export const requestUpload = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    contentType: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
    size: v.number(),
    kind: v.optional(v.literal("custom_module")),
  },
  handler: async (ctx, args): Promise<UploadGrant> => {
    if (!Number.isSafeInteger(args.size) || args.size <= 0) {
      throw new ConvexError<string>("Empty files cannot be uploaded.");
    }
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const requestGrant = () =>
      createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret).requestUploadUrl({
        name: args.name,
        contentType: args.contentType,
        parentId: args.parentId ?? null,
        size: args.size,
        ...(args.kind ? { kind: args.kind } : {}),
      });

    const usage = await readHostedUsage(ctx, args.instanceId, bundle);
    if (usage === null) {
      return await requestGrant();
    }
    if (usage === "engine-outdated") {
      throw new ConvexError<string>(OUTDATED_ENGINE_REFUSAL);
    }
    const reserved = await ctx.runMutation(internal.hostedStorage.reserve, {
      instanceId: args.instanceId,
      engineBytes: usage.engineBytes,
      readAt: usage.readAt,
      size: args.size,
      kind: args.kind ?? "media",
    });
    if ("refusal" in reserved) {
      throw new ConvexError<string>(reserved.refusal);
    }
    try {
      return await requestGrant();
    } finally {
      await ctx.runMutation(internal.hostedStorage.release, { reservationId: reserved.reservationId });
    }
  },
});

/**
 * Step two: the bytes landed. Flips the resource from "pending" to "ready".
 * No size is passed on: the row already holds the size its grant was bound
 * to, which is what storage accepted, and a caller-reported size could
 * understate what hosted storage holds.
 */
export const completeUpload = action({
  args: {
    instanceId: v.id("instances"),
    resourceId: v.string(),
  },
  handler: async (ctx, args): Promise<ResourceDto> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.completeUpload(args.resourceId);
  },
});

/**
 * Uploads to hosted storage are only safe on an engine that binds each grant
 * to its size and reports its total; an older managed engine would accept a
 * body of any length, so it takes no uploads until it is upgraded.
 */
const OUTDATED_ENGINE_REFUSAL =
  "Uploads are paused until this engine is updated to the latest release. Update it from Admin, then try again.";

/**
 * The engine's total of its user assets when the instance is on hosted
 * storage, with when the read began; null when no hosted limit applies, and
 * "engine-outdated" when hosted storage is in use but the engine predates
 * `assets.sizedUploads`. `readAt` is taken before the usage read so
 * reservations released during it are still counted.
 */
async function readHostedUsage(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  bundle: InstanceContext
): Promise<{ engineBytes: number; readAt: number; limits: HostedStorageLimits } | "engine-outdated" | null> {
  const { hosting, limits } = await ctx.runQuery(internal.hostedStorage.context, { instanceId });
  if (hosting !== "managed") {
    return null;
  }
  const [config, capabilities] = await Promise.all([
    createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret).getStorageConfig(),
    fetchEngineCapabilities(bundle),
  ]);
  if (!isOnHostedStorage(hosting, config)) {
    return null;
  }
  if (!hasEngineCapability(capabilities, "assets.sizedUploads")) {
    return "engine-outdated";
  }
  const readAt = Date.now();
  const usage = await createEngineRpcSession<EngineApi>(
    bundle.url,
    bundle.clientId,
    bundle.clientSecret
  ).getResourceUsage();
  return { engineBytes: usage.bytes, readAt, limits };
}

export type HostedStorageUsage = {
  usedBytes: number;
  /** Null is unlimited. */
  limitBytes: number | null;
  /** Null is unlimited. */
  fileLimitBytes: number | null;
};

/** What the Media page's storage meter shows; null when the instance is not on hosted storage. */
export const hostedStorageUsage = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<HostedStorageUsage | null> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const usage = await readHostedUsage(ctx, args.instanceId, bundle);
    if (usage === null || usage === "engine-outdated") {
      return null;
    }
    const usedBytes = await ctx.runQuery(internal.hostedStorage.usedBytes, {
      instanceId: args.instanceId,
      engineBytes: usage.engineBytes,
      readAt: usage.readAt,
    });
    return { usedBytes, limitBytes: usage.limits.totalBytes, fileLimitBytes: usage.limits.fileBytes };
  },
});

export const createFolder = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<ResourceDto> => {
    const name = args.name.trim();
    if (!name) {
      throw new Error("A folder needs a name");
    }
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.createFolder(name, args.parentId ?? null);
  },
});

/** Rename (`name`) and move (`parentId`) are the same engine call. */
export const update = action({
  args: {
    instanceId: v.id("instances"),
    resourceId: v.string(),
    name: v.optional(v.string()),
    parentId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<ResourceDto> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const changes: { name?: string; parentId?: string | null } = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) {
        throw new Error("A name cannot be empty");
      }
      changes.name = name;
    }
    if (args.parentId !== undefined) {
      changes.parentId = args.parentId;
    }
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.updateResource(args.resourceId, changes);
  },
});

/**
 * The engine owns the whole lifecycle now, including the stored bytes and any
 * derived thumbnail — there is no separate storage-cleanup step on this side.
 */
export const remove = action({
  args: { instanceId: v.id("instances"), resourceId: v.string() },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.deleteResource(args.resourceId);
  },
});

/**
 * Ask for a derived thumbnail. Asynchronous: the reply only says the request
 * was accepted. Audio (and anything else the utility cannot render) keeps a
 * null thumbnail rather than failing, so callers must not treat a missing
 * thumbnail as an error.
 */
export const requestProcessing = action({
  args: {
    instanceId: v.id("instances"),
    resourceId: v.string(),
    utility: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ accepted: boolean }> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.requestProcessing(args.resourceId, args.utility ?? "thumbnail");
  },
});
