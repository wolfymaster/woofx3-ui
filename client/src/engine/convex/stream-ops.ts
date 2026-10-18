import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { StreamOpsGateway } from "@/engine/gateway";
import type { InstanceId, SupporterLeaderboardQuery } from "@/engine/types";

function useRecapEngineDetailRequest() {
  const loadEngineDetail = useAction(api.streamRecap.loadEngineDetail);
  return useCallback(
    (instanceId: InstanceId, sessionId: string) => loadEngineDetail({ instanceId, sessionId }),
    [loadEngineDetail]
  );
}

function useRecapTimelineEventsRequest() {
  const loadTimelineEvents = useAction(api.streamRecap.loadTimelineEvents);
  return useCallback(
    (instanceId: InstanceId, sessionId: string) => loadTimelineEvents({ instanceId, sessionId }),
    [loadTimelineEvents]
  );
}

function useOpenSessionRefreshRequest() {
  const refreshOpenSession = useAction(api.streamRecap.refreshOpenSession);
  return useCallback((instanceId: InstanceId) => refreshOpenSession({ instanceId }), [refreshOpenSession]);
}

function useSupporterStreamsRequest() {
  const listStreams = useAction(api.supporters.listStreams);
  return useCallback((instanceId: InstanceId) => listStreams({ instanceId }), [listStreams]);
}

function useSupporterLeaderboardRequest() {
  const leaderboard = useAction(api.supporters.leaderboard);
  return useCallback(
    (instanceId: InstanceId, query: SupporterLeaderboardQuery) => leaderboard({ instanceId, ...query }),
    [leaderboard]
  );
}

function useViewerSupportTotalsRequest() {
  const viewerTotals = useAction(api.supporters.viewerTotals);
  return useCallback(
    (instanceId: InstanceId, platformUserId: string) => viewerTotals({ instanceId, platformUserId }),
    [viewerTotals]
  );
}

export const convexStreamOpsGateway: StreamOpsGateway = {
  useRecapEngineDetailRequest,
  useRecapTimelineEventsRequest,
  useOpenSessionRefreshRequest,
  useSupporterStreamsRequest,
  useSupporterLeaderboardRequest,
  useViewerSupportTotalsRequest,
};
