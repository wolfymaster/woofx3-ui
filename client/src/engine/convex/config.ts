import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { ConfigGateway } from "@/engine/gateway";
import type { ConfigExportRequest, ConfigImportRequest } from "@/engine/types";
import { useInstanceAction } from "./scope";

function useExportRequest() {
  const exportConfig = useInstanceAction(api.configBackup.exportConfig);
  return useCallback((request: ConfigExportRequest) => exportConfig(request), [exportConfig]);
}

function usePreviewImportRequest() {
  const previewImport = useInstanceAction(api.configBackup.previewImport);
  return useCallback((request: ConfigImportRequest) => previewImport(request), [previewImport]);
}

function useImportRequest() {
  const importConfig = useInstanceAction(api.configBackup.importConfig);
  return useCallback((request: ConfigImportRequest) => importConfig(request), [importConfig]);
}

function useStorageConfigRequest() {
  const getConfig = useInstanceAction(api.storage.getConfig);
  return useCallback(() => getConfig({}), [getConfig]);
}

function useSetStorageConfigRequest() {
  const setConfig = useInstanceAction(api.storage.setConfig);
  return useCallback((config: Record<string, unknown>) => setConfig({ config }), [setConfig]);
}

export const convexConfigGateway: ConfigGateway = {
  useExportRequest,
  usePreviewImportRequest,
  useImportRequest,
  useStorageConfigRequest,
  useSetStorageConfigRequest,
};
