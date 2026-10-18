import { useEngineGateway } from "@/engine/context";

/** Lists recent streams for the supporters' range picker. */
export function useSupporterStreamsRequest() {
  return useEngineGateway().streamOps.useSupporterStreamsRequest();
}

/** Ranks supporters by bits or gifted subs, for one stream or all time. */
export function useSupporterLeaderboardRequest() {
  return useEngineGateway().streamOps.useSupporterLeaderboardRequest();
}

/** Reads one viewer's lifetime and recent-stream support. */
export function useViewerSupportTotalsRequest() {
  return useEngineGateway().streamOps.useViewerSupportTotalsRequest();
}
