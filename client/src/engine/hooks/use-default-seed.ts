import { useEngineGateway } from "@/engine/context";

/** Where the default overlay scene and alerts stand; null when the caller cannot see the instance. */
export function useDefaultSeedStatus() {
  return useEngineGateway().defaultSeed.useStatus();
}

/** Applies the default seed again, for what is pending or failed. */
export function useApplyDefaultSeedRequest() {
  return useEngineGateway().defaultSeed.useApplyRequest();
}
