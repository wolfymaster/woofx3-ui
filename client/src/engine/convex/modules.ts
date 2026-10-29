import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
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
import { MODULE_ARCHIVE_CONTENT_TYPE, moduleArchiveFileName } from "@/lib/module-archive";
import { putToGrant } from "@/lib/upload-grant";
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
 * The archive goes to the instance's own storage through the same upload
 * grant every file uses, as a `custom_module` resource: on hosted storage it
 * is checked against the module archive limit and counts toward the total.
 * The engine then installs it from there, checking the approvals itself.
 * The same build already stored (same name, so same key) is installed again
 * rather than stored twice.
 */
function useArchiveInstallRequest() {
  const requestUpload = useInstanceAction(api.resources.requestUpload);
  const completeUpload = useInstanceAction(api.resources.completeUpload);
  const removeResource = useInstanceAction(api.resources.remove);
  const installFromResource = useInstanceAction(api.moduleEngine.installFromResource);
  const listResources = useInstanceAction(api.resources.list);
  return useCallback(
    async ({ archive, manifestId, version, approvedPermissions, approvedLocalEndpoints }: ModuleArchiveInstall) => {
      const name = await moduleArchiveFileName(manifestId, version, archive);
      const stored = await listResources({ folderId: null, kind: "custom_module", search: name, pageSize: 10 });
      const existing = stored.resources.find((resource) => resource.name === name && resource.status === "ready");
      if (existing) {
        return installFromResource({ resourceId: existing.id, approvedPermissions, approvedLocalEndpoints });
      }
      const body = new Blob([archive], { type: MODULE_ARCHIVE_CONTENT_TYPE });
      const grant = await requestUpload({
        name,
        contentType: MODULE_ARCHIVE_CONTENT_TYPE,
        parentId: null,
        size: body.size,
        kind: "custom_module",
      });
      try {
        await putToGrant(grant, body);
      } catch (err) {
        // Best effort: the upload already failed, and a reservation that
        // outlives it is untidy rather than harmful.
        await removeResource({ resourceId: grant.resource.id }).catch(() => {});
        throw err;
      }
      await completeUpload({ resourceId: grant.resource.id });
      return installFromResource({ resourceId: grant.resource.id, approvedPermissions, approvedLocalEndpoints });
    },
    [listResources, requestUpload, completeUpload, removeResource, installFromResource]
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
