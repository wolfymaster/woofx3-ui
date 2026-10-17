"use node";

import type { ModuleFileContent, ModuleFileList } from "@woofx3/api/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import type { MarketplaceAccess } from "./lib/marketplaceAccess";
import {
  type EngineCredentials,
  inspectThroughEngine,
  marketplaceEngineFor,
  marketplaceEngineSession,
  moduleFilesFromInspection,
} from "./lib/marketplaceEngineInstall";
import { buyerTokenFor, type ContentGrant, requireEntitlement } from "./lib/marketplaceEntitlement";
import { listArchiveModuleFiles, readArchiveModuleFile } from "./lib/moduleArchiveFiles";
import { fetchMarketplaceArchive, fetchMarketplaceDownload, marketplaceAccessForInstance } from "./marketplace";
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
  | { kind: "engine"; manifestModuleId: string; engine: EngineCredentials }
  | { kind: "marketplace"; marketplaceId: string; access: MarketplaceAccess; grant: ContentGrant }
  | { kind: "marketplaceEngine"; marketplaceId: string; engine: EngineCredentials };

/**
 * Where a module's files live. `moduleId` is what the detail view identifies
 * the module by, resolved the way `getModuleDetail` resolves it, so the files
 * shown always belong to the version the detail shows.
 *
 * An uninstalled module's file list can come from the engine, which reads the
 * listing's archive itself (`marketplaceEngineFor` decides). The engine has no
 * call that reads one file of an uninstalled listing, so `read` always uses
 * the archive fetched here.
 */
async function resolveFileSource(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  moduleId: string,
  purpose: "list"
): Promise<FileSource>;
async function resolveFileSource(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  moduleId: string,
  purpose: "read"
): Promise<Exclude<FileSource, { kind: "marketplaceEngine" }>>;
async function resolveFileSource(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  moduleId: string,
  purpose: "list" | "read"
): Promise<FileSource> {
  const installed = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, { instanceId, moduleId });
  if (installed?.status !== "installed") {
    const viaEngine = purpose === "list" ? await marketplaceEngineFor(ctx, instanceId) : null;
    if (viaEngine) {
      return { kind: "marketplaceEngine", marketplaceId: moduleId, engine: viaEngine };
    }
    // A module not yet installed is read from its marketplace archive, which
    // for a paid module is the product itself: only a buyer may browse it.
    return {
      kind: "marketplace",
      marketplaceId: moduleId,
      access: await marketplaceAccessForInstance(ctx, instanceId),
      grant: await requireEntitlement(ctx, instanceId, moduleId, moduleId),
    };
  }
  const engine = await requireEngineInstance(ctx, instanceId);
  // A moduleKey is `{manifest id}:{version}:{hash}`; the engine addresses modules by the manifest id.
  const manifestModuleId = installed.moduleKey?.split(":")[0] || installed.name;
  return { kind: "engine", manifestModuleId, engine };
}

async function fetchArchive(source: Extract<FileSource, { kind: "marketplace" }>): Promise<Uint8Array> {
  return await fetchMarketplaceArchive(
    await fetchMarketplaceDownload(source.marketplaceId, source.access, source.grant)
  );
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
    const source = await resolveFileSource(ctx, instanceId, moduleId, "list");
    try {
      if (source.kind === "engine") {
        const { url, clientId, clientSecret } = source.engine;
        return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).listModuleFiles(
          source.manifestModuleId
        );
      }
      if (source.kind === "marketplaceEngine") {
        const { engine, marketplaceId } = source;
        const inspection = await inspectThroughEngine(
          { engine: () => marketplaceEngineSession(engine), buyerToken: () => buyerTokenFor(ctx, instanceId) },
          marketplaceId,
          marketplaceId
        );
        return moduleFilesFromInspection(inspection);
      }
      return listArchiveModuleFiles(await fetchArchive(source));
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
    const source = await resolveFileSource(ctx, instanceId, moduleId, "read");
    try {
      if (source.kind === "engine") {
        const { url, clientId, clientSecret } = source.engine;
        return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).getModuleFile(
          source.manifestModuleId,
          path
        );
      }
      return readArchiveModuleFile(await fetchArchive(source), path);
    } catch (error) {
      throw toClientError(error, "getModuleFile");
    }
  },
});
