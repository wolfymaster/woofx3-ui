import { api } from "@convex/_generated/api";
import { useCallback } from "react";
import type { StreamOpsGateway } from "@/engine/gateway";
import type { EngineTestEvent, SupporterLeaderboardQuery } from "@/engine/types";
import { useInstanceAction } from "./scope";

function useRecapEngineDetailRequest() {
  const loadEngineDetail = useInstanceAction(api.streamRecap.loadEngineDetail);
  return useCallback((sessionId: string) => loadEngineDetail({ sessionId }), [loadEngineDetail]);
}

function useRecapTimelineEventsRequest() {
  const loadTimelineEvents = useInstanceAction(api.streamRecap.loadTimelineEvents);
  return useCallback((sessionId: string) => loadTimelineEvents({ sessionId }), [loadTimelineEvents]);
}

function useOpenSessionRefreshRequest() {
  const refreshOpenSession = useInstanceAction(api.streamRecap.refreshOpenSession);
  return useCallback(() => refreshOpenSession({}), [refreshOpenSession]);
}

function useSupporterStreamsRequest() {
  const listStreams = useInstanceAction(api.supporters.listStreams);
  return useCallback(() => listStreams({}), [listStreams]);
}

function useSupporterLeaderboardRequest() {
  const leaderboard = useInstanceAction(api.supporters.leaderboard);
  return useCallback((query: SupporterLeaderboardQuery) => leaderboard(query), [leaderboard]);
}

function useViewerSupportTotalsRequest() {
  const viewerTotals = useInstanceAction(api.supporters.viewerTotals);
  return useCallback((platformUserId: string) => viewerTotals({ platformUserId }), [viewerTotals]);
}

function usePublishEventRequest() {
  const fireTrigger = useInstanceAction(api.debug.fireTrigger);
  return useCallback((event: EngineTestEvent) => fireTrigger(event), [fireTrigger]);
}

function useSimulateTwitchEventRequest() {
  const simulateTwitchEvent = useInstanceAction(api.debug.simulateTwitchEvent);
  return useCallback((event: EngineTestEvent) => simulateTwitchEvent(event), [simulateTwitchEvent]);
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
