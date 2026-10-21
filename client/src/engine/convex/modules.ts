import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ModulesGateway } from "@/engine/gateway";
import type { InstanceId, ModuleDetail, ModuleId } from "@/engine/types";
import { fromInstanceId, fromModuleId, toModuleId } from "./ids";

function toModuleDetail({
  moduleDbId,
  ...detail
}: FunctionReturnType<typeof api.moduleDetail.getModuleDetail>): ModuleDetail {
  // The action types this id as a plain string; it is the installed module's moduleRepository row.
  return { ...detail, moduleDbId: toModuleId(moduleDbId as Id<"moduleRepository"> | undefined) };
}

function useDetailRequest() {
  const getModuleDetail = useAction(api.moduleDetail.getModuleDetail);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) =>
      getModuleDetail({ instanceId: fromInstanceId(instanceId), moduleId }).then(toModuleDetail),
    [getModuleDetail]
  );
}

function useSettingsRequest() {
  const getModuleSettings = useAction(api.moduleSettingsActions.getModuleSettings);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) =>
      getModuleSettings({ instanceId: fromInstanceId(instanceId), moduleId }),
    [getModuleSettings]
  );
}

function useUpdateSettingRequest() {
  const updateModuleSetting = useAction(api.moduleSettingsActions.updateModuleSetting);
  return useCallback(
    (instanceId: InstanceId, moduleId: string, key: string, value: string) =>
      updateModuleSetting({ instanceId: fromInstanceId(instanceId), moduleId, key, value }),
    [updateModuleSetting]
  );
}

function useFilesRequest() {
  const listModuleFiles = useAction(api.moduleFiles.listModuleFiles);
  return useCallback(
    (instanceId: InstanceId, moduleId: string) => listModuleFiles({ instanceId: fromInstanceId(instanceId), moduleId }),
    [listModuleFiles]
  );
}

function useFileRequest() {
  const readModuleFile = useAction(api.moduleFiles.readModuleFile);
  return useCallback(
    (instanceId: InstanceId, moduleId: string, path: string) =>
      readModuleFile({ instanceId: fromInstanceId(instanceId), moduleId, path }),
    [readModuleFile]
  );
}

function useUninstallRequest() {
  const requestModuleUninstall = useAction(api.moduleEngine.requestModuleUninstall);
  return useCallback(
    (instanceId: InstanceId, moduleId: ModuleId) =>
      requestModuleUninstall({ instanceId: fromInstanceId(instanceId), moduleId: fromModuleId(moduleId) }),
    [requestModuleUninstall]
  );
}

function useReconcileUninstallRequest() {
  const reconcileUninstall = useAction(api.moduleEngine.reconcileUninstall);
  return useCallback(
    (instanceId: InstanceId, moduleId: ModuleId, correlationKey: string) =>
      reconcileUninstall({ instanceId: fromInstanceId(instanceId), moduleId: fromModuleId(moduleId), correlationKey }),
    [reconcileUninstall]
  );
}

function useWorkflowsRequest() {
  const listWorkflows = useAction(api.moduleEngine.listWorkflows);
  return useCallback(
    (instanceId: InstanceId) => listWorkflows({ instanceId: fromInstanceId(instanceId) }),
    [listWorkflows]
  );
}

function useMarketplaceInstallRequest() {
  const installModule = useAction(api.marketplace.installModule);
  return useCallback(
    (
      instanceId: InstanceId,
      marketplaceModuleId: string,
      approvedPermissions: string[],
      approvedLocalEndpoints: string[]
    ) =>
      installModule({
        instanceId: fromInstanceId(instanceId),
        marketplaceModuleId,
        approvedPermissions,
        approvedLocalEndpoints,
      }),
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
