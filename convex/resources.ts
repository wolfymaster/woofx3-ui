import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

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
  applicationId: string;
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
    applicationId: bundle.applicationId,
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
 * returned headers and never branches on which backend is configured.
 */
export const requestUpload = action({
  args: {
    instanceId: v.id("instances"),
    name: v.string(),
    contentType: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.requestUploadUrl({
      name: args.name,
      contentType: args.contentType,
      parentId: args.parentId ?? null,
      size: args.size,
    });
  },
});

/** Step two: the bytes landed. Flips the resource from "pending" to "ready". */
export const completeUpload = action({
  args: {
    instanceId: v.id("instances"),
    resourceId: v.string(),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ResourceDto> => {
    const bundle = await requireInstanceContext(ctx, args.instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return await rpc.completeUpload(args.resourceId, args.size);
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
