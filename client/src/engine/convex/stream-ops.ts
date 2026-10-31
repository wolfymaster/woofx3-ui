import { api } from "@convex/_generated/api";
import type { RecapClip as ConvexRecapClip } from "@convex/lib/recapClips";
import type { RecapMarker as ConvexRecapMarker } from "@convex/lib/recapMarkers";
import type { RecapClipsResult, RecapMarkersResult } from "@convex/streamRecap";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { StreamOpsGateway } from "@/engine/gateway";
import type {
  EngineTestEvent,
  ReadOptions,
  RecapClip,
  RecapClips,
  RecapMarker,
  RecapMarkers,
  StreamRecap,
  SupporterLeaderboardQuery,
} from "@/engine/types";
import { withPlainError } from "./errors";
import { useMappedList, useMappedValue } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

type SummaryRow = FunctionReturnType<typeof api.streamSessionSummaries.listRecent>[number];

/** A stored summary as a recap; one in a schema this deployment does not interpret keeps only its version. */
export function toStreamRecap(row: SummaryRow): StreamRecap {
  const { session, totals } = row;
  return {
    sessionId: row.sessionId,
    generatedAt: row.generatedAt,
    generatedAtMs: row.generatedAtMs,
    inProgress: row.inProgress,
    summary:
      session && totals
        ? {
            kind: "read",
            session: {
              status: session.status,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              segments: session.segments.map((segment) => ({
                id: segment.id,
                startedAt: segment.startedAt,
                endedAt: segment.endedAt,
              })),
            },
            totals: {
              bits: totals.bits,
              cheers: totals.cheers,
              subs: totals.subs,
              giftedSubs: totals.giftedSubs,
              follows: totals.follows,
              raids: totals.raids,
              raiders: totals.raiders,
              peakViewers: totals.peakViewers,
              averageViewers: totals.averageViewers,
              viewerSampleMinutes: totals.viewerSampleMinutes,
            },
          }
        : { kind: "unreadable", schemaVersion: row.schemaVersion },
  };
}

function toRecapClip(clip: ConvexRecapClip): RecapClip {
  return {
    id: clip.id,
    url: clip.url,
    title: clip.title,
    creatorName: clip.creatorName,
    viewCount: clip.viewCount,
    createdAt: clip.createdAt,
    thumbnailUrl: clip.thumbnailUrl,
    durationSeconds: clip.durationSeconds,
    offsetMs: clip.offsetMs,
  };
}

export function toRecapClips(result: RecapClipsResult): RecapClips {
  return result.status === "ok" ? { status: "ok", clips: result.clips.map(toRecapClip) } : result;
}

function toRecapMarker(marker: ConvexRecapMarker): RecapMarker {
  return { id: marker.id, createdAt: marker.createdAt, description: marker.description };
}

export function toRecapMarkers(result: RecapMarkersResult): RecapMarkers {
  return result.status === "ok" ? { status: "ok", markers: result.markers.map(toRecapMarker) } : result;
}

function useRecentRecaps(limit: number, { enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.streamSessionSummaries.listRecent, enabled && instanceId ? { instanceId, limit } : "skip");
  return useMappedList(rows, toStreamRecap);
}

function useRecap(sessionId: string, { enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.streamSessionSummaries.get, enabled && instanceId ? { instanceId, sessionId } : "skip");
  return useMappedValue(row, toStreamRecap);
}

function useRecapClipsRequest() {
  const loadClips = useInstanceAction(api.streamRecap.loadClips);
  return useCallback(
    async (sessionId: string) => toRecapClips(await loadClips({ sessionId }).catch(withPlainError)),
    [loadClips]
  );
}

function useRecapMarkersRequest() {
  const loadMarkers = useInstanceAction(api.streamRecap.loadMarkers);
  return useCallback(
    async (sessionId: string) => toRecapMarkers(await loadMarkers({ sessionId }).catch(withPlainError)),
    [loadMarkers]
  );
}

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
  support: { recapClips: true, recapMarkers: true },
  useRecentRecaps,
  useRecap,
  useRecapClipsRequest,
  useRecapMarkersRequest,
  useRecapEngineDetailRequest,
  useRecapTimelineEventsRequest,
  useOpenSessionRefreshRequest,
  useSupporterStreamsRequest,
  useSupporterLeaderboardRequest,
  useViewerSupportTotalsRequest,
  usePublishEventRequest,
  useSimulateTwitchEventRequest,
};
