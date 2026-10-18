import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { StreamOpsGateway } from "@/engine/gateway";
import type { EngineTestEvent, InstanceId, SupporterLeaderboardQuery } from "@/engine/types";

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

function usePublishEventRequest() {
  const fireTrigger = useAction(api.debug.fireTrigger);
  return useCallback(
    (instanceId: InstanceId, event: EngineTestEvent) => fireTrigger({ instanceId, ...event }),
    [fireTrigger]
  );
}

function useSimulateTwitchEventRequest() {
  const simulateTwitchEvent = useAction(api.debug.simulateTwitchEvent);
  return useCallback(
    (instanceId: InstanceId, event: EngineTestEvent) => simulateTwitchEvent({ instanceId, ...event }),
    [simulateTwitchEvent]
  );
}

export const convexStreamOpsGateway: StreamOpsGateway = {
  useRecapEngineDetailRequest,
  useRecapTimelineEventsRequest,
  useOpenSessionRefreshRequest,
  useSupporterStreamsRequest,
  useSupporterLeaderboardRequest,
  useViewerSupportTotalsRequest,
  usePublishEventRequest,
  useSimulateTwitchEventRequest,
};
