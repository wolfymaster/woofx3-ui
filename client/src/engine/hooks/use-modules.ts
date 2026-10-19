import { useEngineGateway } from "@/engine/context";

/** Fetches a module's detail, merged with its marketplace listing when it has one. */
export function useModuleDetailRequest() {
  return useEngineGateway().modules.useDetailRequest();
}

export function useModuleSettingsRequest() {
  return useEngineGateway().modules.useSettingsRequest();
}

export function useUpdateModuleSettingRequest() {
  return useEngineGateway().modules.useUpdateSettingRequest();
}

export function useModuleFilesRequest() {
  return useEngineGateway().modules.useFilesRequest();
}

export function useModuleFileRequest() {
  return useEngineGateway().modules.useFileRequest();
}

/** Starts an uninstall; its outcome arrives under the returned key. */
export function useUninstallModuleRequest() {
  return useEngineGateway().modules.useUninstallRequest();
}

export function useReconcileModuleUninstallRequest() {
  return useEngineGateway().modules.useReconcileUninstallRequest();
}

/** Lists the engine's workflows by id and name. */
export function useEngineWorkflowsRequest() {
  return useEngineGateway().modules.useWorkflowsRequest();
}

/** Starts a marketplace install or update; its progress and outcome arrive under the returned key. */
export function useMarketplaceInstallRequest() {
  return useEngineGateway().modules.useMarketplaceInstallRequest();
}
