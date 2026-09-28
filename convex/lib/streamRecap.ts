import type { EngineApi } from "./engineInstanceUrl";

/**
 * Engine analytics shapes the stream recap reads. They must match
 * `LeaderboardQuery`, `Leaderboard`, `LeaderboardEntry` and `StreamGaugeSample`
 * in woofx3 shared/clients/typescript/api/api.ts. They are declared here
 * rather than imported so the UI does not depend on which engine checkout the
 * `@woofx3/api` path alias happens to resolve to.
 */

export type LeaderboardMetric = "bits" | "giftedSubs";

export interface LeaderboardQuery {
  metric: LeaderboardMetric;
  sessionId?: string;
  minTotal?: number;
  limit?: number;
}

export interface LeaderboardEntry {
  platform: string;
  platformUserId: string;
  /** The name on the viewer's most recent event; null when none carried one. */
  userName: string | null;
  /** Bits, or subs gifted. */
  total: number;
  /** Cheers, or gift events. */
  events: number;
}

export interface Leaderboard {
  metric: LeaderboardMetric;
  sessionId: string | null;
  minTotal: number;
  entries: LeaderboardEntry[];
}

/**
 * One sampled minute. A minute with no sample was not sampled, which is not
 * zero viewers; a null metric is one whose read failed that minute.
 */
export interface StreamGaugeSample {
  sampledAt: string;
  viewerCount: number | null;
  followerTotal: number | null;
  subscriberTotal: number | null;
  subscriberPoints: number | null;
}

export interface StreamRecapEngineApi extends EngineApi {
  getLeaderboard(query: LeaderboardQuery): Promise<Leaderboard | null>;
  getStreamSessionGauges(sessionId: string): Promise<StreamGaugeSample[] | null>;
}

/** Supporters shown per leaderboard on a recap. */
export const RECAP_LEADERBOARD_LIMIT = 5;

export interface RecapSupporter {
  platformUserId: string;
  userName: string | null;
  total: number;
  events: number;
}

export interface RecapViewerSample {
  sampledAt: string;
  viewerCount: number | null;
}

/**
 * What the recap page gets from the engine. `unreachable` covers an engine
 * that is offline or refused the call; the recap still renders from the
 * stored summary in that case.
 */
export type StreamRecapEngineDetail =
  | {
      status: "ok";
      viewerSamples: RecapViewerSample[];
      topCheerers: RecapSupporter[];
      topGifters: RecapSupporter[];
    }
  | { status: "unregistered" }
  | { status: "unknown_session" }
  | { status: "unreachable" };

/**
 * Builds the recap payload from raw engine answers, copying only the fields
 * the page shows so nothing else the engine returns reaches the browser.
 * Any null answer means the engine no longer knows the session: a split or
 * merge after the summary was sent can retire its id.
 */
export function toRecapEngineDetail(
  gauges: StreamGaugeSample[] | null,
  cheerers: Leaderboard | null,
  gifters: Leaderboard | null
): StreamRecapEngineDetail {
  if (gauges === null || cheerers === null || gifters === null) {
    return { status: "unknown_session" };
  }
  const toSupporter = (entry: LeaderboardEntry): RecapSupporter => ({
    platformUserId: entry.platformUserId,
    userName: entry.userName,
    total: entry.total,
    events: entry.events,
  });
  return {
    status: "ok",
    viewerSamples: gauges.map((sample) => ({ sampledAt: sample.sampledAt, viewerCount: sample.viewerCount })),
    topCheerers: cheerers.entries.slice(0, RECAP_LEADERBOARD_LIMIT).map(toSupporter),
    topGifters: gifters.entries.slice(0, RECAP_LEADERBOARD_LIMIT).map(toSupporter),
  };
}
