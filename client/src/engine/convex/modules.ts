import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { ModulesGateway } from "@/engine/gateway";
import type {
  MarketplaceBundleInstall,
  ModuleArchiveInstall,
  ModuleDetail,
  ModuleId,
  ModuleStorageUsage,
} from "@/engine/types";
import { fromModuleId, toModuleId } from "./ids";
import { useInstanceAction, useInstanceMutation } from "./scope";

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

function toModuleStorageUsage(result: FunctionReturnType<typeof api.moduleStorage.usage>): ModuleStorageUsage | null {
  if (result === null) {
    return null;
  }
  return { usedBytes: result.usedBytes, limitBytes: result.limitBytes, over: result.over };
}

function useStorageUsageRequest() {
  const moduleStorageUsage = useInstanceAction(api.moduleStorage.usage);
  return useCallback(() => moduleStorageUsage({}).then(toModuleStorageUsage), [moduleStorageUsage]);
}

/**
 * Convex keeps the archive in its file storage, records the module as
 * pending with its manifest, and hands the archive to the engine from a
 * scheduled action.
 */
function useArchiveInstallRequest() {
  const generateUploadUrl = useMutation(api.moduleRepository.generateUploadUrl);
  const uploadAndDeliver = useInstanceMutation(api.moduleRepository.uploadAndDeliver);
  return useCallback(
    async ({ archive, moduleKey, name, description, version, tags, manifest }: ModuleArchiveInstall) => {
      const uploadUrl = await generateUploadUrl();
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: new Blob([archive], { type: "application/zip" }),
      });
      if (!uploaded.ok) {
        throw new Error("Upload failed");
      }
      const { storageId } = (await uploaded.json()) as { storageId: Id<"_storage"> };
      await uploadAndDeliver({ moduleKey, name, description, version, tags, manifest, archiveKey: storageId });
      return { moduleKey };
    },
    [generateUploadUrl, uploadAndDeliver]
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
  useStorageUsageRequest,
  useArchiveInstallRequest,
};
