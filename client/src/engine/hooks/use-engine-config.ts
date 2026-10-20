import { useEngineGateway } from "@/engine/context";

/** Exports the engine's configuration as backup text, in chunks to join. */
export function useConfigExportRequest() {
  return useEngineGateway().config.useExportRequest();
}

/** Plans a backup import without applying it. */
export function useConfigImportPreviewRequest() {
  return useEngineGateway().config.usePreviewImportRequest();
}

export function useConfigImportRequest() {
  return useEngineGateway().config.useImportRequest();
}

/** Reads the engine's storage backend; null when the engine cannot be asked. */
export function useStorageConfigRequest() {
  return useEngineGateway().config.useStorageConfigRequest();
}

export function useSetStorageConfigRequest() {
  return useEngineGateway().config.useSetStorageConfigRequest();
}
