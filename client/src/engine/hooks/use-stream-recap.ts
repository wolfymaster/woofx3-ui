import { useEngineGateway } from "@/engine/context";

/** Fetches a recapped session's viewer samples and top supporters from the engine. */
export function useRecapEngineDetailRequest() {
  return useEngineGateway().streamOps.useRecapEngineDetailRequest();
}

/** Fetches a recapped session's events for the timeline. Needs `analytics.sessionEvents`. */
export function useRecapTimelineEventsRequest() {
  return useEngineGateway().streamOps.useRecapTimelineEventsRequest();
}

/** Asks for a snapshot of the engine's open session to be stored as its summary. */
export function useOpenSessionRefreshRequest() {
  return useEngineGateway().streamOps.useOpenSessionRefreshRequest();
}
