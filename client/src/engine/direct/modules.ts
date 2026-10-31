import { assetsOfKinds, manifestAssets } from "@shared/module-assets";
import {
  applyMarketplaceMetadata,
  type MarketplaceMergeData,
  marketplaceDetail,
  marketplaceMetadataOf,
} from "@shared/module-detail";
import { declaredSettingsOnly } from "@shared/module-settings-visibility";
import type { EngineModuleSummary, MarketplaceListingInspection } from "@woofx3/api";
import type { ModulesGateway } from "@/engine/gateway";
import type {
  EngineWorkflowOption,
  InstalledModule,
  MarketplaceBundleInstall,
  ModuleAsset,
  ModuleDetail,
  ModuleFileContent,
  ModuleFileList,
  ModuleId,
  ModuleSettingValue,
  ModuleStorageUsage,
} from "@/engine/types";
import { fromModuleId } from "./ids";
import { MODULE_INVALIDATIONS } from "./invalidations";
import { directKeys as k } from "./keys";
import {
  catalogModuleRecord,
  inspectionLocalEndpoints,
  isModuleNamed,
  toInstalledModule,
  toInstalledModuleDetail,
  toModuleDetail,
  toModuleSettingValue,
} from "./map/modules";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { unsupportedRequest } from "./unsupported";

/**
 * A paid listing needs a buyer token, which only an account can mint. The
 * engine alone installs and browses free listings.
 */
function paidListingMessage(name: string): string {
  return `${name} is a paid module. Sign in to your woofx3 account to buy and install it.`;
}

/**
 * The engine sends a module's assets only as it installs them, so the list is
 * read from the installed manifest's `assets[]`, the same declarations the
 * engine registers them from.
 */
function assetsRead(runtime: DirectRuntime, moduleId: string, kinds: readonly string[]): EngineRead<ModuleAsset[]> {
  return {
    queryKey: k.modules.assets(moduleId, kinds),
    queryFn: async () => {
      const modules = await runtime.call("listEngineModules", (api) => api.listEngineModules());
      const module = modules.find((summary) => summary.moduleId === moduleId);
      return module === undefined ? [] : assetsOfKinds(manifestAssets(module.manifest, moduleId), kinds);
    },
  };
}

function installedRead(runtime: DirectRuntime): EngineRead<InstalledModule[]> {
  return {
    queryKey: k.modules.installed(),
    queryFn: async () =>
      (await runtime.call("listEngineModules", (api) => api.listEngineModules())).map(toInstalledModule),
  };
}

export function directModulesGateway(runtime: DirectRuntime): ModulesGateway {
  const installedModules = () => runtime.call("listEngineModules", (api) => api.listEngineModules());

  const installedModule = async (moduleId: string): Promise<EngineModuleSummary | undefined> =>
    (await installedModules()).find((summary) => isModuleNamed(summary, moduleId));

  const invalidateModules = () =>
    Promise.all(MODULE_INVALIDATIONS().map((queryKey) => runtime.queryClient.invalidateQueries({ queryKey })));

  /** The build an install would use. Null when it cannot be read, such as a paid listing's. */
  const inspectListing = async (listingId: string): Promise<MarketplaceListingInspection | null> => {
    try {
      return await runtime.call("inspectMarketplaceListing", (api) => api.inspectMarketplaceListing(listingId));
    } catch (error) {
      runtime.logger.warn("could not inspect marketplace listing", { listingId, error });
      return null;
    }
  };

  /** A marketplace miss must not fail an installed module's detail. */
  const listingMetadata = async (listingId: string): Promise<MarketplaceMergeData | null> => {
    try {
      return marketplaceMetadataOf(
        catalogModuleRecord(await runtime.call("marketplaceGetListing", (api) => api.marketplaceGetListing(listingId)))
      );
    } catch {
      return null;
    }
  };

  const detail = async (moduleId: string): Promise<ModuleDetail> => {
    const summary = await installedModule(moduleId);
    if (summary === undefined) {
      const [listing, inspection] = await Promise.all([
        runtime.call("marketplaceGetListing", (api) => api.marketplaceGetListing(moduleId)),
        inspectListing(moduleId),
      ]);
      return toModuleDetail({
        ...marketplaceDetail(moduleId, catalogModuleRecord(listing), null),
        permissions: inspection?.permissions ?? null,
        localEndpoints: inspection ? inspectionLocalEndpoints(inspection) : null,
      });
    }

    const listingId = summary.marketplaceListingId;
    const [catalog, functions, widgets, metadata] = await Promise.all([
      runtime.call("getWorkflowCatalog", (api) => api.getWorkflowCatalog()),
      runtime.call("listAvailableFunctions", (api) => api.listAvailableFunctions()),
      runtime.call("getAvailableWidgets", (api) => api.getAvailableWidgets()),
      listingId ? listingMetadata(listingId) : Promise.resolve(null),
    ]);
    const result = toInstalledModuleDetail(summary, { catalog, functions, widgets: widgets.widgets });
    if (metadata) {
      applyMarketplaceMetadata(result, metadata);
    }
    if (listingId && result.latestVersion !== undefined && result.latestVersion !== result.version) {
      const latest = await inspectListing(listingId);
      result.latestPermissions = latest?.permissions ?? null;
      result.latestLocalEndpoints = latest ? inspectionLocalEndpoints(latest) : null;
    }
    return toModuleDetail(result);
  };

  /**
   * Only declared settings reach the browser: a module also stores its own
   * state and its OAuth tokens as settings (see `declaredSettingsOnly`).
   */
  const settings = async (moduleId: string): Promise<ModuleSettingValue[]> => {
    const [manifest, stored] = await Promise.all([
      runtime.call("getModuleManifest", (api) => api.getModuleManifest(moduleId)),
      runtime.call("getModuleSettings", (api) => api.getModuleSettings(moduleId)),
    ]);
    return declaredSettingsOnly(stored.settings, manifest).map(toModuleSettingValue);
  };

  const updateSetting = async (moduleId: string, key: string, value: string): Promise<ModuleSettingValue> => {
    const manifest = await runtime.call("getModuleManifest", (api) => api.getModuleManifest(moduleId));
    if (declaredSettingsOnly([{ key }], manifest).length === 0) {
      throw new Error(`${moduleId} has no setting "${key}"`);
    }
    return toModuleSettingValue(
      await runtime.call("updateModuleSetting", (api) => api.updateModuleSetting(moduleId, key, value))
    );
  };

  const files = async (moduleId: string): Promise<ModuleFileList> => {
    const summary = await installedModule(moduleId);
    if (summary === undefined) {
      const inspection = await runtime.call("inspectMarketplaceListing", (api) =>
        api.inspectMarketplaceListing(moduleId)
      );
      return { available: true, files: inspection.files.map(({ path, size }) => ({ path, size })) };
    }
    return await runtime.call("listModuleFiles", (api) => api.listModuleFiles(summary.moduleId));
  };

  /** The engine reads files of installed modules only; a listing's are listed but not read. */
  const file = async (moduleId: string, path: string): Promise<ModuleFileContent> => {
    if (path === "") {
      throw new Error("A file path is required");
    }
    const summary = await installedModule(moduleId);
    if (summary === undefined) {
      throw new Error("Install the module to read its files.");
    }
    return await runtime.call("getModuleFile", (api) => api.getModuleFile(summary.moduleId, path));
  };

  const uninstall = async (moduleId: ModuleId): Promise<{ moduleKey: string }> => {
    const summary = await installedModule(fromModuleId(moduleId));
    if (summary === undefined) {
      throw new Error("The module is not installed.");
    }
    await runtime.call("uninstallModule", (api) => api.uninstallModule(summary.moduleKey));
    return { moduleKey: summary.moduleKey };
  };

  const reconcileUninstall = async (moduleId: ModuleId): Promise<{ stillInstalled: boolean }> => {
    const stillInstalled = (await installedModule(fromModuleId(moduleId))) !== undefined;
    if (!stillInstalled) {
      await invalidateModules();
    }
    return { stillInstalled };
  };

  const workflows = async (): Promise<EngineWorkflowOption[]> => {
    const result = await runtime.call("getWorkflows", (api) => api.getWorkflows());
    return result.workflows.map((workflow) => ({ id: workflow.id, name: workflow.name }));
  };

  const marketplaceInstall = async (
    listingId: string,
    approvedPermissions: string[],
    approvedLocalEndpoints: string[]
  ): Promise<{ moduleKey: string }> => {
    const result = await runtime.call("installMarketplaceListing", (api) =>
      api.installMarketplaceListing(listingId, { approvedPermissions, approvedLocalEndpoints })
    );
    switch (result.status) {
      case "installed":
        return { moduleKey: result.moduleKey };
      case "needs_approval": {
        const asked = [...result.unapproved, ...result.unapprovedLocalEndpoints.map((id) => `local endpoint ${id}`)];
        throw new Error(
          `${result.name}@${result.version} asks for access that was not approved (${asked.join(", ")}). ` +
            "Review the module and install again."
        );
      }
      case "payment_required":
        throw new Error(paidListingMessage(result.name));
    }
  };

  const bundleInstall = async (listingId: string): Promise<MarketplaceBundleInstall> => {
    const result = await runtime.call("installMarketplaceBundle", (api) => api.installMarketplaceBundle(listingId));
    if (result.status === "payment_required") {
      throw new Error(paidListingMessage(result.name));
    }
    return { kind: result.kind, engineId: result.engineId };
  };

  /** Module storage is limited by a hosting plan; an engine on the streamer's own machine has none. */
  const storageUsage = async (): Promise<ModuleStorageUsage | null> => null;

  return {
    useInstalled: () => useEngineQuery(runtime, installedRead(runtime)),
    useDetailRequest: () => useEngineRequest(detail),
    useSettingsRequest: () => useEngineRequest(settings),
    useUpdateSettingRequest: () => useEngineRequest(updateSetting),
    useFilesRequest: () => useEngineRequest(files),
    useFileRequest: () => useEngineRequest(file),
    useUninstallRequest: () => useEngineRequest(uninstall),
    useReconcileUninstallRequest: () => useEngineRequest(reconcileUninstall),
    useWorkflowsRequest: () => useEngineRequest(workflows),
    useMarketplaceInstallRequest: () => useEngineRequest(marketplaceInstall),
    useBundleInstallRequest: () => useEngineRequest(bundleInstall),
    useStorageUsageRequest: () => useEngineRequest(storageUsage),
    useArchiveInstallRequest: unsupportedRequest("modules.useArchiveInstallRequest"),
    useAssets: (moduleId, kinds) => useEngineQuery(runtime, assetsRead(runtime, fromModuleId(moduleId), kinds ?? [])),
  };
}
