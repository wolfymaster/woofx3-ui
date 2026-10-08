"use node";

import type { ModuleFileContent, ModuleFileList } from "@woofx3/api/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { listArchiveModuleFiles, readArchiveModuleFile } from "./lib/moduleArchiveFiles";
import { fetchMarketplaceArchive, fetchMarketplaceDownload } from "./marketplace";
import { requireEngineInstance } from "./moduleSettingsActions";

/**
 * Every file a module ships, for the read-only file browser on the module
 * detail view. An installed module's files come from the engine, which keeps
 * the archive it installed; a module that is not installed is read from its
 * marketplace archive with the engine's rules (lib/moduleArchiveFiles.ts), so
 * both answer with the engine's shapes and the browser has one code path.
 */

const moduleFileListValidator = v.object({
  available: v.boolean(),
  files: v.array(v.object({ path: v.string(), size: v.number() })),
});

const moduleFileContentValidator = v.union(
  v.object({ path: v.string(), size: v.number(), kind: v.literal("text"), content: v.string() }),
  v.object({ path: v.string(), size: v.number(), kind: v.literal("binary") }),
  v.object({ path: v.string(), size: v.number(), kind: v.literal("too_large") })
);

const UPDATE_ENGINE_MESSAGE = "Update WoofX3 to browse this module's files.";

type FileSource =
  | { kind: "engine"; manifestModuleId: string; engine: { url: string; clientId: string; clientSecret: string } }
  | { kind: "marketplace"; marketplaceId: string };

/**
 * Where a module's files live. `moduleId` is what the detail view identifies
 * the module by, resolved the way `getModuleDetail` resolves it, so the files
 * shown always belong to the version the detail shows.
 */
async function resolveFileSource(ctx: ActionCtx, instanceId: Id<"instances">, moduleId: string): Promise<FileSource> {
  const installed = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, { instanceId, moduleId });
  if (installed?.status !== "installed") {
    return { kind: "marketplace", marketplaceId: moduleId };
  }
  const engine = await requireEngineInstance(ctx, instanceId);
  // A moduleKey is `{manifest id}:{version}:{hash}`; the engine addresses modules by the manifest id.
  const manifestModuleId = installed.moduleKey?.split(":")[0] || installed.name;
  return { kind: "engine", manifestModuleId, engine };
}

async function fetchArchive(marketplaceId: string): Promise<Uint8Array> {
  return await fetchMarketplaceArchive(await fetchMarketplaceDownload(marketplaceId));
}

/**
 * The error a browser can show. An engine without the file methods answers
 * with capnweb's refusal of an unknown method; the browser gates on the
 * `modules.files` capability, so this only catches an engine that changed
 * between that check and this call.
 */
function toClientError(error: unknown, method: string): ConvexError<string> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(`'${method}' is not a function`)) {
    return new ConvexError(UPDATE_ENGINE_MESSAGE);
  }
  return new ConvexError(message);
}

export const listModuleFiles = action({
  args: { instanceId: v.id("instances"), moduleId: v.string() },
  returns: moduleFileListValidator,
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleFileList> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const source = await resolveFileSource(ctx, instanceId, moduleId);
    try {
      if (source.kind === "engine") {
        const { url, clientId, clientSecret } = source.engine;
        return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).listModuleFiles(
          source.manifestModuleId
        );
      }
      return listArchiveModuleFiles(await fetchArchive(source.marketplaceId));
    } catch (error) {
      throw toClientError(error, "listModuleFiles");
    }
  },
});

export const readModuleFile = action({
  args: { instanceId: v.id("instances"), moduleId: v.string(), path: v.string() },
  returns: moduleFileContentValidator,
  handler: async (ctx, { instanceId, moduleId, path }): Promise<ModuleFileContent> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    if (path === "") {
      throw new ConvexError("A file path is required");
    }
    const source = await resolveFileSource(ctx, instanceId, moduleId);
    try {
      if (source.kind === "engine") {
        const { url, clientId, clientSecret } = source.engine;
        return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).getModuleFile(
          source.manifestModuleId,
          path
        );
      }
      return readArchiveModuleFile(await fetchArchive(source.marketplaceId), path);
    } catch (error) {
      throw toClientError(error, "getModuleFile");
    }
  },
});
