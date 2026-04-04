import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { UploadIntent } from "./types";

/**
 * Generate an upload intent using Convex built-in storage.
 * Must be called from a mutation context (ctx.storage.generateUploadUrl is mutation-only).
 */
export async function generateConvexUploadIntent(ctx: MutationCtx): Promise<UploadIntent> {
  const uploadUrl = await ctx.storage.generateUploadUrl();
  return {
    uploadUrl,
    method: "POST",
    fileKey: "", // real key comes from the upload response body as { storageId }
    provider: "convex",
    requiresResponseKey: true,
  };
}

/**
 * Resolve a Convex storage file key to a signed URL.
 * Can be called from query or mutation context.
 */
export async function resolveConvexUrl(
  ctx: QueryCtx | MutationCtx,
  fileKey: string
): Promise<string | null> {
  return ctx.storage.getUrl(fileKey as Id<"_storage">);
}

/**
 * Delete a file from Convex storage.
 * Must be called from a mutation context.
 */
export async function deleteConvexFile(ctx: MutationCtx, fileKey: string): Promise<void> {
  await ctx.storage.delete(fileKey as Id<"_storage">);
}
