import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ModulesGateway } from "@/engine/gateway";
import type { MarketplaceBundleInstall, ModuleDetail, ModuleId } from "@/engine/types";
import { fromModuleId, toModuleId } from "./ids";
import { useInstanceAction } from "./scope";

function toModuleDetail(result: FunctionReturnType<typeof api.moduleDetail.getModuleDetail>): ModuleDetail {
  return {
    id: result.id,
    name: result.name,
    description: result.description,
    version: result.version,
    latestVersion: result.latestVersion,
    author: result.author,
    category: result.category,
    tags: result.tags,
    iconUrl: result.iconUrl,
    readme: result.readme,
    isInstalled: result.isInstalled,
    triggers: result.triggers,
    actions: result.actions,
    functions: result.functions,
    widgets: result.widgets,
    workflows: result.workflows,
    moduleDbId: toModuleId(result.moduleDbId),
    manifestSettings: result.manifestSettings,
    manifestResourceKinds: result.manifestResourceKinds,
    permissions: result.permissions,
    latestPermissions: result.latestPermissions,
    localEndpoints: result.localEndpoints,
    latestLocalEndpoints: result.latestLocalEndpoints,
  };
}

function useDetailRequest() {
  const getModuleDetail = useInstanceAction(api.moduleDetail.getModuleDetail);
  return useCallback((moduleId: string) => getModuleDetail({ moduleId }).then(toModuleDetail), [getModuleDetail]);
}

function useSettingsRequest() {
  const getModuleSettings = useInstanceAction(api.moduleSettingsActions.getModuleSettings);
  return useCallback((moduleId: string) => getModuleSettings({ moduleId }), [getModuleSettings]);
}

function useUpdateSettingRequest() {
  const updateModuleSetting = useInstanceAction(api.moduleSettingsActions.updateModuleSetting);
  return useCallback(
    (moduleId: string, key: string, value: string) => updateModuleSetting({ moduleId, key, value }),
    [updateModuleSetting]
  );
}

function useFilesRequest() {
  const listModuleFiles = useInstanceAction(api.moduleFiles.listModuleFiles);
  return useCallback((moduleId: string) => listModuleFiles({ moduleId }), [listModuleFiles]);
}

function useFileRequest() {
  const readModuleFile = useInstanceAction(api.moduleFiles.readModuleFile);
  return useCallback((moduleId: string, path: string) => readModuleFile({ moduleId, path }), [readModuleFile]);
}

function useUninstallRequest() {
  const requestModuleUninstall = useInstanceAction(api.moduleEngine.requestModuleUninstall);
  return useCallback(
    (moduleId: ModuleId) => requestModuleUninstall({ moduleId: fromModuleId(moduleId) }),
    [requestModuleUninstall]
  );
}

function useReconcileUninstallRequest() {
  const reconcileUninstall = useInstanceAction(api.moduleEngine.reconcileUninstall);
  return useCallback(
    (moduleId: ModuleId, correlationKey: string) =>
      reconcileUninstall({ moduleId: fromModuleId(moduleId), correlationKey }),
    [reconcileUninstall]
  );
}

function useWorkflowsRequest() {
  const listWorkflows = useInstanceAction(api.moduleEngine.listWorkflows);
  return useCallback(() => listWorkflows({}), [listWorkflows]);
}

function useBundleInstallRequest() {
  const installBundle = useInstanceAction(api.marketplaceCatalog.installBundle);
  return useCallback(
    async (listingId: string): Promise<MarketplaceBundleInstall> => {
      const { kind, engineId } = await installBundle({ listingId });
      return { kind, engineId };
    },
    [installBundle]
  );
}

function useMarketplaceInstallRequest() {
  const installModule = useInstanceAction(api.marketplace.installModule);
  return useCallback(
    (marketplaceModuleId: string, approvedPermissions: string[], approvedLocalEndpoints: string[]) =>
      installModule({
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
  useBundleInstallRequest,
};
