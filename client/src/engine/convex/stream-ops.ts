import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback } from "react";
import type { StreamOpsGateway } from "@/engine/gateway";
import type { EngineTestEvent, InstanceId, SupporterLeaderboardQuery } from "@/engine/types";
import { fromInstanceId } from "./ids";

function useRecapEngineDetailRequest() {
  const loadEngineDetail = useAction(api.streamRecap.loadEngineDetail);
  return useCallback(
    (instanceId: InstanceId, sessionId: string) =>
      loadEngineDetail({ instanceId: fromInstanceId(instanceId), sessionId }),
    [loadEngineDetail]
  );
}

function useRecapTimelineEventsRequest() {
  const loadTimelineEvents = useAction(api.streamRecap.loadTimelineEvents);
  return useCallback(
    (instanceId: InstanceId, sessionId: string) =>
      loadTimelineEvents({ instanceId: fromInstanceId(instanceId), sessionId }),
    [loadTimelineEvents]
  );
}

function useOpenSessionRefreshRequest() {
  const refreshOpenSession = useAction(api.streamRecap.refreshOpenSession);
  return useCallback(
    (instanceId: InstanceId) => refreshOpenSession({ instanceId: fromInstanceId(instanceId) }),
    [refreshOpenSession]
  );
}

function useSupporterStreamsRequest() {
  const listStreams = useAction(api.supporters.listStreams);
  return useCallback(
    (instanceId: InstanceId) => listStreams({ instanceId: fromInstanceId(instanceId) }),
    [listStreams]
  );
}

function useSupporterLeaderboardRequest() {
  const leaderboard = useAction(api.supporters.leaderboard);
  return useCallback(
    (instanceId: InstanceId, query: SupporterLeaderboardQuery) =>
      leaderboard({ instanceId: fromInstanceId(instanceId), ...query }),
    [leaderboard]
  );
}

function useViewerSupportTotalsRequest() {
  const viewerTotals = useAction(api.supporters.viewerTotals);
  return useCallback(
    (instanceId: InstanceId, platformUserId: string) =>
      viewerTotals({ instanceId: fromInstanceId(instanceId), platformUserId }),
    [viewerTotals]
  );
}

function usePublishEventRequest() {
  const fireTrigger = useAction(api.debug.fireTrigger);
  return useCallback(
    (instanceId: InstanceId, event: EngineTestEvent) =>
      fireTrigger({ instanceId: fromInstanceId(instanceId), ...event }),
    [fireTrigger]
  );
}

function useSimulateTwitchEventRequest() {
  const simulateTwitchEvent = useAction(api.debug.simulateTwitchEvent);
  return useCallback(
    (instanceId: InstanceId, event: EngineTestEvent) =>
      simulateTwitchEvent({ instanceId: fromInstanceId(instanceId), ...event }),
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
