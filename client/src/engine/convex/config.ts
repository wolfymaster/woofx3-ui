import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { ConfigGateway } from "@/engine/gateway";
import type { ConfigExportRequest, ConfigImportRequest, InstanceId } from "@/engine/types";
import { fromInstanceId } from "./ids";

function useExportRequest() {
  const exportConfig = useAction(api.configBackup.exportConfig);
  return useCallback(
    (instanceId: InstanceId, request: ConfigExportRequest) =>
      exportConfig({ instanceId: fromInstanceId(instanceId), ...request }),
    [exportConfig]
  );
}

function usePreviewImportRequest() {
  const previewImport = useAction(api.configBackup.previewImport);
  return useCallback(
    (instanceId: InstanceId, request: ConfigImportRequest) =>
      previewImport({ instanceId: fromInstanceId(instanceId), ...request }),
    [previewImport]
  );
}

function useImportRequest() {
  const importConfig = useAction(api.configBackup.importConfig);
  return useCallback(
    (instanceId: InstanceId, request: ConfigImportRequest) =>
      importConfig({ instanceId: fromInstanceId(instanceId), ...request }),
    [importConfig]
  );
}

function useStorageConfigRequest() {
  const getConfig = useAction(api.storage.getConfig);
  return useCallback((instanceId: InstanceId) => getConfig({ instanceId: fromInstanceId(instanceId) }), [getConfig]);
}

function useSetStorageConfigRequest() {
  const setConfig = useAction(api.storage.setConfig);
  return useCallback(
    (instanceId: InstanceId, config: Record<string, unknown>) =>
      setConfig({ instanceId: fromInstanceId(instanceId), config }),
    [setConfig]
  );
}

export const convexConfigGateway: ConfigGateway = {
  useExportRequest,
  usePreviewImportRequest,
  useImportRequest,
  useStorageConfigRequest,
  useSetStorageConfigRequest,
};
