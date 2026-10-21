import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** Asks the engine for its release and settings; resolves null when it is not registered or did not answer. */
export function useEngineInfoRequest() {
  return useEngineGateway().status.useEngineInfoRequest();
}

/** Moves the public address the engine's overlays are served from. Owner or admin only. */
export function useSetOverlayPublicUrlRequest() {
  return useEngineGateway().status.useSetOverlayPublicUrlRequest();
}

/** Pings an engine by URL, registered or not. */
export function useEngineConnectionTest() {
  return useEngineGateway().status.useConnectionTestRequest();
}

/** The mirror's sync schedule and recent runs. */
export function useEngineSyncState(options?: ReadOptions) {
  return useEngineGateway().status.useSyncState(options);
}

/** Schedules a sync now, unless one is already running. */
export function useEngineSyncRequest() {
  return useEngineGateway().status.useSyncRequest();
}
