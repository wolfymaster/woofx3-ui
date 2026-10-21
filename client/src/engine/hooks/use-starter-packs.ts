import { useEngineGateway } from "@/engine/context";

/** Each starter-pack item's state on the engine, keyed by `starterItemKey`; null when the caller cannot see the instance. */
export function useStarterPackStatus() {
  return useEngineGateway().starterPacks.useStatus();
}

/** Installs a starter pack's items on the engine, answering with each item's outcome. */
export function useInstallStarterPackRequest() {
  return useEngineGateway().starterPacks.useInstallRequest();
}
