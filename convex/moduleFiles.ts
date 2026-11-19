"use node";

import { INSTALL_TO_BROWSE_MESSAGE, type ModuleFileListing, NOT_INSTALLED_FILE_LIST } from "@shared/module-files";
import type { ModuleFileContent } from "@woofx3/api/api";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import type { EngineCredentials } from "./lib/marketplaceEngineInstall";
import { requireEngineInstance } from "./moduleSettingsActions";

/**
 * Every file a module ships, for the read-only file browser on the module
 * detail view. Only an installed module's files are readable, and they come
 * from the engine, which keeps the archive it installed. A listing that is not
 * installed answers "not installed" instead of downloading its archive.
 */

const moduleFileListValidator = v.object({
  available: v.boolean(),
  files: v.array(v.object({ path: v.string(), size: v.number() })),
  notInstalled: v.optional(v.literal(true)),
});

const moduleFileContentValidator = v.union(
  v.object({ path: v.string(), size: v.number(), kind: v.literal("text"), content: v.string() }),
  v.object({ path: v.string(), size: v.number(), kind: v.literal("binary") }),
  v.object({ path: v.string(), size: v.number(), kind: v.literal("too_large") })
);

interface InstalledFileSource {
  manifestModuleId: string;
  engine: EngineCredentials;
}

/**
 * The engine that holds a module's files, or null when the module is not
 * installed. `moduleId` is what the detail view identifies the module by,
 * resolved the way `getModuleDetail` resolves it, so the files shown always
 * belong to the version the detail shows.
 */
async function resolveInstalledSource(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  moduleId: string
): Promise<InstalledFileSource | null> {
  const installed = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, { instanceId, moduleId });
  if (installed?.status !== "installed") {
    return null;
  }
  const engine = await requireEngineInstance(ctx, instanceId);
  // A moduleKey is `{manifest id}:{version}:{hash}`; the engine addresses modules by the manifest id.
  const manifestModuleId = installed.moduleKey?.split(":")[0] || installed.name;
  return { manifestModuleId, engine };
}

/** The error a browser can show. */
function toClientError(error: unknown): ConvexError<string> {
  return new ConvexError(error instanceof Error ? error.message : String(error));
}

export const listModuleFiles = action({
  args: { instanceId: v.id("instances"), moduleId: v.string() },
  returns: moduleFileListValidator,
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleFileListing> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const source = await resolveInstalledSource(ctx, instanceId, moduleId);
    if (source === null) {
      return NOT_INSTALLED_FILE_LIST;
    }
    try {
      const { url, clientId, clientSecret } = source.engine;
      return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).listModuleFiles(
        source.manifestModuleId
      );
    } catch (error) {
      throw toClientError(error);
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
    const source = await resolveInstalledSource(ctx, instanceId, moduleId);
    if (source === null) {
      throw new ConvexError(INSTALL_TO_BROWSE_MESSAGE);
    }
    try {
      const { url, clientId, clientSecret } = source.engine;
      return await createEngineRpcSession<EngineApi>(url, clientId, clientSecret).getModuleFile(
        source.manifestModuleId,
        path
      );
    } catch (error) {
      throw toClientError(error);
    }
  },
});
