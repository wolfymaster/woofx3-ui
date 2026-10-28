import type { ConfigBundle, StorageConfig } from "@woofx3/api";
import type { ConfigGateway } from "@/engine/gateway";
import type { ConfigExportRequest, ConfigImportRequest } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/**
 * A backup's text, joined from its chunks and parsed. The engine checks
 * everything else about it (format, version, size) and says what is wrong,
 * so only what stops it reaching the engine is checked here.
 */
function readBundle(request: ConfigImportRequest): ConfigBundle {
  const text = request.bundleChunks.join("");
  if (text.trim() === "") {
    throw new Error("The backup file is empty.");
  }
  if (request.include.length === 0) {
    throw new Error("Choose at least one section.");
  }
  try {
    return JSON.parse(text) as ConfigBundle;
  } catch {
    throw new Error("The backup file is not valid JSON.");
  }
}

const STORAGE_PROVIDERS: ReadonlySet<unknown> = new Set<StorageConfig["provider"]>(["file", "s3"]);

function isStorageConfig(config: Record<string, unknown>): config is Record<string, unknown> & StorageConfig {
  return STORAGE_PROVIDERS.has(config.provider);
}

/**
 * Backups and the storage backend, asked of the engine. The engine has one
 * owner when driven directly, so no role decides who may.
 */
export function directConfigGateway(runtime: DirectRuntime): ConfigGateway {
  // The contract hands a backup over in chunks to join; with no transport
  // limit between this client and the engine, one chunk holds it all.
  const exportConfig = async (request: ConfigExportRequest) => {
    if (request.include.length === 0) {
      throw new Error("Choose at least one section.");
    }
    const bundle = await runtime.call("exportConfig", (api) =>
      api.exportConfig({ include: request.include, includeMembers: request.includeMembers })
    );
    return [`${JSON.stringify(bundle, null, 2)}\n`];
  };

  const previewImport = async (request: ConfigImportRequest) => {
    const bundle = readBundle(request);
    return runtime.call("previewImport", (api) =>
      api.previewImport(bundle, {
        onConflict: request.onConflict,
        include: request.include,
        applyMembers: request.applyMembers,
      })
    );
  };

  const importConfig = async (request: ConfigImportRequest) => {
    const bundle = readBundle(request);
    return runtime.call("importConfig", (api) =>
      api.importConfig(bundle, {
        onConflict: request.onConflict,
        include: request.include,
        applyMembers: request.applyMembers,
      })
    );
  };

  // Null when the engine did not answer, as the contract has it.
  const storageConfig = async (): Promise<StorageConfig | null> => {
    try {
      return await runtime.call("getStorageConfig", (api) => api.getStorageConfig());
    } catch (error) {
      runtime.logger.warn("DirectGateway: the engine did not say where it keeps files", { error });
      return null;
    }
  };

  // The settings form builds the backend's fields from its own schema. Only
  // the provider is checked here; the engine validates the rest and refuses
  // what it cannot use.
  const setStorageConfig = async (config: Record<string, unknown>) => {
    if (!isStorageConfig(config)) {
      throw new Error("Choose where the engine keeps files: on disk or in S3.");
    }
    const result = await runtime.call("setStorageConfig", (api) => api.setStorageConfig(config));
    if (!result.success) {
      throw new Error(result.message ?? "The engine refused the storage settings.");
    }
    return { success: true };
  };

  return {
    useExportRequest: () => useEngineRequest(exportConfig),
    usePreviewImportRequest: () => useEngineRequest(previewImport),
    useImportRequest: () => useEngineRequest(importConfig),
    useStorageConfigRequest: () => useEngineRequest(storageConfig),
    useSetStorageConfigRequest: () => useEngineRequest(setStorageConfig),
  };
}
