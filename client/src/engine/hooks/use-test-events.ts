import { useEngineGateway } from "@/engine/context";

/** Publishes an event onto the engine's bus as given. */
export function usePublishTestEventRequest() {
  return useEngineGateway().streamOps.usePublishEventRequest();
}

/** Publishes a synthetic Twitch event the engine stamps as Twitch's. */
export function useSimulateTwitchEventRequest() {
  return useEngineGateway().streamOps.useSimulateTwitchEventRequest();
}
