import { useEngineGateway } from "@/engine/context";
import type { ReadOptions } from "@/engine/types";

/** The checklist's dismissals, last run and workflow facts; null when the caller cannot see the instance. */
export function useGoLiveChecklistState(options?: ReadOptions) {
  return useEngineGateway().goLive.useChecklist(options);
}

/** The instance's scenes and browser sources, as the checklist checks them. */
export function useGoLiveOverlayFacts(options?: ReadOptions) {
  return useEngineGateway().goLive.useOverlays(options);
}

export function useSetGoLiveCheckDismissedRequest() {
  return useEngineGateway().goLive.useSetCheckDismissedRequest();
}

export function useGoLiveTwitchCheckRequest() {
  return useEngineGateway().goLive.useCheckTwitchRequest();
}

export function useGoLiveStreamInfoCheckRequest() {
  return useEngineGateway().goLive.useCheckStreamInfoRequest();
}

/** Posts the announcement and drops the start marker; each step reports its own outcome. */
export function useCompleteGoLiveRequest() {
  return useEngineGateway().goLive.useCompleteRequest();
}
