import {
  MAX_RECENT_RECAPS,
  RECAP_EVENT_LIMIT,
  RECAP_LEADERBOARD_LIMIT,
  toRecapEngineDetail,
  toRecapTimelineEvents,
} from "@shared/stream-recap";
import {
  attributedSupporters,
  isValidMinTotal,
  LEADERBOARD_LIMIT,
  NO_SUPPORT,
  recentLiveStreams,
  STREAM_PICKER_LIMIT,
  SUPPORTER_PLATFORM,
  type SupporterTotals,
  toSupporterStream,
  toSupporterTotals,
  VIEWER_RECENT_STREAMS,
  VIEWER_STREAM_SCAN,
} from "@shared/supporters";
import { ENGINE_CAPABILITIES, type StreamSession } from "@woofx3/api";
import type { StreamOpsGateway } from "@/engine/gateway";
import type {
  EngineTestEvent,
  OpenSessionRefresh,
  RecapTimelineEvents,
  StreamRecap,
  StreamRecapEngineDetail,
  Supporter,
  SupporterLeaderboardQuery,
  SupporterStream,
  ViewerSupportTotals,
} from "@/engine/types";
import { directKeys as k } from "./keys";
import { toEngineCallFailure, toStreamRecap, toSupporterReadError } from "./map/stream-ops";
import { type EngineRead, useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { liveStateRead } from "./status";
import { unsupportedRequest } from "./unsupported";

/** The engine's sessions read as recaps, in its order, leaving out any it no longer has totals for. */
async function readRecaps(runtime: DirectRuntime, sessions: readonly StreamSession[]): Promise<StreamRecap[]> {
  const [live, totals] = await Promise.all([
    runtime.queryClient.fetchQuery(liveStateRead(runtime)),
    Promise.all(
      sessions.map((session) => runtime.call("getStreamSessionTotals", (api) => api.getStreamSessionTotals(session.id)))
    ),
  ]);
  const readAtMs = runtime.clock.now();
  const recaps: StreamRecap[] = [];
  sessions.forEach((session, index) => {
    const sessionTotals = totals[index];
    if (sessionTotals !== null && sessionTotals !== undefined) {
      recaps.push(toStreamRecap(session, sessionTotals, live, readAtMs));
    }
  });
  return recaps;
}

// An engine without session history has no recaps to show, rather than a
// failure: there is nothing it could answer on a retry.
function recentRecapsRead(runtime: DirectRuntime, limit: number): EngineRead<StreamRecap[]> {
  return {
    queryKey: k.streamOps.recentRecaps(limit),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.analyticsSessions)) {
        return [];
      }
      const page = await runtime.call("listStreamSessions", (api) => api.listStreamSessions({ limit }));
      return readRecaps(runtime, page.sessions);
    },
  };
}

function recapRead(runtime: DirectRuntime, sessionId: string): EngineRead<StreamRecap | null> {
  return {
    queryKey: k.streamOps.recap(sessionId),
    queryFn: async () => {
      if (!runtime.supports(ENGINE_CAPABILITIES.analyticsSessions)) {
        return null;
      }
      const session = await runtime.call("getStreamSession", (api) => api.getStreamSession(sessionId));
      if (session === null) {
        return null;
      }
      const [recap] = await readRecaps(runtime, [session]);
      return recap ?? null;
    },
  };
}

/** A whole number of recaps from 1 to `MAX_RECENT_RECAPS`, as the hosted list reads them. */
function recapLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit), 1), MAX_RECENT_RECAPS);
}

/**
 * What the engine records about the channel's streams and the viewers who
 * support them. Recaps are the engine's sessions and totals, cached and read
 * again on stream and session events and when a page refreshes the open
 * session, since its totals change with no event to say so. Everything else
 * is read on demand. The recap detail and events resolve with a failure
 * status rather than rejecting, so the page still renders the recap. Clips
 * and markers are Twitch's lists, which the engine has no method for.
 */
export function directStreamOpsGateway(runtime: DirectRuntime): StreamOpsGateway {
  const recapEngineDetail = async (sessionId: string): Promise<StreamRecapEngineDetail> => {
    try {
      const [gauges, cheerers, gifters] = await Promise.all([
        runtime.call("getStreamSessionGauges", (api) => api.getStreamSessionGauges(sessionId)),
        runtime.call("getLeaderboard", (api) =>
          api.getLeaderboard({ metric: "bits", sessionId, limit: RECAP_LEADERBOARD_LIMIT })
        ),
        runtime.call("getLeaderboard", (api) =>
          api.getLeaderboard({ metric: "giftedSubs", sessionId, limit: RECAP_LEADERBOARD_LIMIT })
        ),
      ]);
      return toRecapEngineDetail(gauges, cheerers, gifters);
    } catch (error) {
      const failure = toEngineCallFailure(error, runtime.connection.session.state);
      runtime.logger.warn("stream recap: engine call failed", { sessionId, status: failure.status });
      return failure;
    }
  };

  const recapTimelineEvents = async (sessionId: string): Promise<RecapTimelineEvents> => {
    try {
      const answer = await runtime.call("getStreamSessionEvents", (api) =>
        api.getStreamSessionEvents({ sessionId, limit: RECAP_EVENT_LIMIT })
      );
      return toRecapTimelineEvents(answer);
    } catch (error) {
      const failure = toEngineCallFailure(error, runtime.connection.session.state);
      runtime.logger.warn("stream recap: engine events call failed", { sessionId, status: failure.status });
      return failure;
    }
  };

  const refreshOpenSession = async (): Promise<OpenSessionRefresh> => {
    await runtime.queryClient.invalidateQueries({ queryKey: k.streamOps.allRecaps });
    return { status: "stored" };
  };

  /** Runs `read`, rejecting with the Supporters page's words for `what` when it fails. */
  const supporterRead = async <T>(what: string, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      throw toSupporterReadError(what, error);
    }
  };

  const supporterStreams = (): Promise<SupporterStream[]> =>
    supporterRead("your streams", async () => {
      const page = await runtime.call("listStreamSessions", (api) =>
        api.listStreamSessions({ limit: STREAM_PICKER_LIMIT })
      );
      return page.sessions.map(toSupporterStream);
    });

  const supporterLeaderboard = async ({
    metric,
    sessionId,
    minTotal,
  }: SupporterLeaderboardQuery): Promise<Supporter[]> => {
    if (!isValidMinTotal(minTotal)) {
      throw new Error("The minimum must be a whole number of at least 1.");
    }
    const board = await supporterRead("the leaderboard", () =>
      runtime.call("getLeaderboard", (api) =>
        api.getLeaderboard({
          metric,
          minTotal,
          limit: LEADERBOARD_LIMIT,
          ...(sessionId !== undefined ? { sessionId } : {}),
        })
      )
    );
    if (board === null) {
      // Splits and merges can retire a session id the picker still holds.
      throw new Error("That stream no longer exists. Pick it again from the list.");
    }
    return attributedSupporters(board.entries);
  };

  // A stream the engine no longer has (merged away between the two reads) is
  // left out rather than shown as zero.
  const viewerSupportTotals = async (platformUserId: string): Promise<ViewerSupportTotals> => {
    if (platformUserId.trim() === "") {
      throw new Error("Pick a viewer to look up.");
    }
    const viewer = { platform: SUPPORTER_PLATFORM, platformUserId };
    const [lifetime, page] = await supporterRead("this viewer's totals", () =>
      Promise.all([
        runtime.call("getViewerTotals", (api) => api.getViewerTotals(viewer)),
        runtime.call("listStreamSessions", (api) => api.listStreamSessions({ limit: VIEWER_STREAM_SCAN })),
      ])
    );
    const streams = recentLiveStreams(page.sessions.map(toSupporterStream), VIEWER_RECENT_STREAMS);
    const perStream = await supporterRead("this viewer's stream totals", () =>
      Promise.all(
        streams.map((stream) =>
          runtime.call("getViewerTotals", (api) => api.getViewerTotals({ ...viewer, sessionId: stream.id }))
        )
      )
    );
    const recent: { stream: SupporterStream; totals: SupporterTotals }[] = [];
    streams.forEach((stream, index) => {
      const totals = perStream[index];
      if (totals !== null && totals !== undefined) {
        recent.push({ stream, totals: toSupporterTotals(totals) });
      }
    });
    return {
      userName: lifetime?.userName ?? null,
      lifetime: lifetime === null ? NO_SUPPORT : toSupporterTotals(lifetime),
      recent,
    };
  };

  const publishEvent = ({ eventType, eventData, triggerId, triggeredBy }: EngineTestEvent) =>
    runtime.call("triggerEvent", (api) =>
      api.triggerEvent(eventType, eventData as Record<string, unknown>, triggerId, triggeredBy)
    );

  const simulateTwitchEvent = ({ eventType, eventData, triggerId, triggeredBy }: EngineTestEvent) =>
    runtime.call("simulateTwitchEvent", (api) =>
      api.simulateTwitchEvent(eventType, eventData as Record<string, unknown>, triggerId, triggeredBy)
    );

  return {
    support: { recapClips: false, recapMarkers: false },
    useRecentRecaps: (limit, options) =>
      useEngineQuery(runtime, recentRecapsRead(runtime, recapLimit(limit)), { enabled: options?.enabled }),
    useRecap: (sessionId, options) =>
      useEngineQuery(runtime, recapRead(runtime, sessionId), { enabled: options?.enabled }),
    useRecapClipsRequest: unsupportedRequest("streamOps.useRecapClipsRequest"),
    useRecapMarkersRequest: unsupportedRequest("streamOps.useRecapMarkersRequest"),
    useRecapEngineDetailRequest: () => useEngineRequest(recapEngineDetail),
    useRecapTimelineEventsRequest: () => useEngineRequest(recapTimelineEvents),
    useOpenSessionRefreshRequest: () => useEngineRequest(refreshOpenSession),
    useSupporterStreamsRequest: () => useEngineRequest(supporterStreams),
    useSupporterLeaderboardRequest: () => useEngineRequest(supporterLeaderboard),
    useViewerSupportTotalsRequest: () => useEngineRequest(viewerSupportTotals),
    usePublishEventRequest: () => useEngineRequest(publishEvent),
    useSimulateTwitchEventRequest: () => useEngineRequest(simulateTwitchEvent),
  };
}
