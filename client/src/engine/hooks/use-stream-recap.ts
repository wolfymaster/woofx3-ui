import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** What this connection to the engine can serve of a recap. */
export function useStreamOpsSupport() {
  return useEngineGateway().streamOps.support;
}

/** The newest sessions' recaps, newest first. */
export function useRecentRecaps(limit: number, options?: ReadOptions) {
  return useEngineGateway().streamOps.useRecentRecaps(limit, options);
}

/** One session's recap; null when there is none. */
export function useRecap(sessionId: string, options?: ReadOptions) {
  return useEngineGateway().streamOps.useRecap(sessionId, options);
}

/** Lists a recapped session's clips from Twitch. Needs `support.recapClips`. */
export function useRecapClipsRequest() {
  return useEngineGateway().streamOps.useRecapClipsRequest();
}

/** Lists a recapped session's stream markers from Twitch. Needs `support.recapMarkers`. */
export function useRecapMarkersRequest() {
  return useEngineGateway().streamOps.useRecapMarkersRequest();
}

/** Fetches a recapped session's viewer samples and top supporters from the engine. */
export function useRecapEngineDetailRequest() {
  return useEngineGateway().streamOps.useRecapEngineDetailRequest();
}

/** Fetches a recapped session's events for the timeline. Needs `analytics.sessionEvents`. */
export function useRecapTimelineEventsRequest() {
  return useEngineGateway().streamOps.useRecapTimelineEventsRequest();
}

/** Brings the open session's recap up to date. */
export function useOpenSessionRefreshRequest() {
  return useEngineGateway().streamOps.useOpenSessionRefreshRequest();
}
