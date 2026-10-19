import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { ModulesGateway } from "@/engine/gateway";
import type { InstanceId, ModuleId } from "@/engine/types";

function useDetailRequest() {
  const getModuleDetail = useAction(api.moduleDetail.getModuleDetail);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) => getModuleDetail({ instanceId, moduleId }),
    [getModuleDetail]
  );
}

function useSettingsRequest() {
  const getModuleSettings = useAction(api.moduleSettingsActions.getModuleSettings);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) => getModuleSettings({ instanceId, moduleId }),
    [getModuleSettings]
  );
}

function useUpdateSettingRequest() {
  const updateModuleSetting = useAction(api.moduleSettingsActions.updateModuleSetting);
  return useCallback(
    (instanceId: InstanceId, moduleId: string, key: string, value: string) =>
      updateModuleSetting({ instanceId, moduleId, key, value }),
    [updateModuleSetting]
  );
}

function useFilesRequest() {
  const listModuleFiles = useAction(api.moduleFiles.listModuleFiles);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) => listModuleFiles({ instanceId, moduleId }),
    [listModuleFiles]
  );
}

function useFileRequest() {
  const readModuleFile = useAction(api.moduleFiles.readModuleFile);
  return useCallback(
    (instanceId: InstanceId, moduleId: string, path: string) => readModuleFile({ instanceId, moduleId, path }),
    [readModuleFile]
  );
}

function useUninstallRequest() {
  const requestModuleUninstall = useAction(api.moduleEngine.requestModuleUninstall);
  return useCallback(
    (instanceId: InstanceId, moduleId: ModuleId) => requestModuleUninstall({ instanceId, moduleId }),
    [requestModuleUninstall]
  );
}

function useReconcileUninstallRequest() {
  const reconcileUninstall = useAction(api.moduleEngine.reconcileUninstall);
  return useCallback(
    (instanceId: InstanceId, moduleId: ModuleId, correlationKey: string) =>
      reconcileUninstall({ instanceId, moduleId, correlationKey }),
    [reconcileUninstall]
  );
}

function useWorkflowsRequest() {
  const listWorkflows = useAction(api.moduleEngine.listWorkflows);
  return useCallback((instanceId: InstanceId) => listWorkflows({ instanceId }), [listWorkflows]);
}

function useMarketplaceInstallRequest() {
  const installModule = useAction(api.marketplace.installModule);
  return useCallback(
    (
      instanceId: InstanceId,
      marketplaceModuleId: string,
      approvedPermissions: string[],
      approvedLocalEndpoints: string[]
    ) => installModule({ instanceId, marketplaceModuleId, approvedPermissions, approvedLocalEndpoints }),
    [installModule]
  );
}

export const convexModulesGateway: ModulesGateway = {
  useDetailRequest,
  useSettingsRequest,
  useUpdateSettingRequest,
  useFilesRequest,
  useFileRequest,
  useUninstallRequest,
  useReconcileUninstallRequest,
  useWorkflowsRequest,
  useMarketplaceInstallRequest,
};
