// Shapes and pure helpers behind the Supporters page. Per-viewer figures pass
// through Convex on their way from the engine to the browser and are never
// written to a table: the engine's analytics design keeps per-viewer detail on
// the streamer's own machine, and the multi-tenant store holds summaries only.

/** Must match `LeaderboardMetric` in the woofx3 engine's `@woofx3/api` (api.ts). */
export type SupporterMetric = "bits" | "giftedSubs";

export const SUPPORTER_METRICS: readonly SupporterMetric[] = ["bits", "giftedSubs"];

/** The platform every figure on the page is read for; the engine keys viewers by platform. */
export const SUPPORTER_PLATFORM = "twitch";

/** Rows on one leaderboard. The engine allows up to 100. */
export const LEADERBOARD_LIMIT = 25;

/** Streams offered in the range picker, newest first. The engine allows up to 200. */
export const STREAM_PICKER_LIMIT = 50;

/** Most recent live streams a viewer's per-stream totals cover. */
export const VIEWER_RECENT_STREAMS = 5;

/**
 * Sessions read to find those live streams. Some sessions were never live, so
 * this reads a few times as many; a run of more dead sessions than that just
 * shows fewer streams.
 */
export const VIEWER_STREAM_SCAN = VIEWER_RECENT_STREAMS * 3;

/** Must match `StreamSessionSegment` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EngineStreamSegment {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

/** Must match `StreamSession` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EngineStreamSession {
  id: string;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  segments: EngineStreamSegment[];
}

/** Must match `PaginatedStreamSessions` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EnginePaginatedStreamSessions {
  sessions: EngineStreamSession[];
  total: number;
  limit: number;
  offset: number;
}

/** Must match `LeaderboardEntry` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EngineLeaderboardEntry {
  platform: string;
  platformUserId: string;
  userName: string | null;
  total: number;
  events: number;
}

/** Must match `Leaderboard` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EngineLeaderboard {
  metric: SupporterMetric;
  sessionId: string | null;
  minTotal: number;
  entries: EngineLeaderboardEntry[];
}

/** Must match `ViewerTotals` in the woofx3 engine's `@woofx3/api` (api.ts). */
export interface EngineViewerTotals {
  platform: string;
  platformUserId: string;
  userName: string | null;
  sessionId: string | null;
  bits: number;
  cheers: number;
  giftedSubs: number;
  gifts: number;
}

/**
 * The engine methods this page calls, with the argument shapes of
 * `listStreamSessions`, `getLeaderboard` and `getViewerTotals` in the woofx3
 * engine's `@woofx3/api` (api.ts). Declared here because the engine checkout
 * the UI type-checks against may predate them.
 */
export interface SupporterEngineMethods {
  listStreamSessions(query?: { limit?: number; offset?: number }): Promise<EnginePaginatedStreamSessions>;
  getLeaderboard(query: {
    metric: SupporterMetric;
    sessionId?: string;
    minTotal?: number;
    limit?: number;
  }): Promise<EngineLeaderboard | null>;
  getViewerTotals(query: {
    platform: string;
    platformUserId: string;
    sessionId?: string;
  }): Promise<EngineViewerTotals | null>;
}

export interface SupporterStream {
  id: string;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  segments: Array<{ startedAt: string; endedAt: string | null }>;
}

export interface Supporter {
  platformUserId: string;
  userName: string | null;
  total: number;
  events: number;
}

/** What one viewer gave: `bits` and `giftedSubs` are the amounts, `cheers` and `gifts` the events behind them. */
export interface SupporterTotals {
  bits: number;
  cheers: number;
  giftedSubs: number;
  gifts: number;
}

export interface ViewerStreamTotals {
  stream: SupporterStream;
  totals: SupporterTotals;
}

export function toSupporterStream(session: EngineStreamSession): SupporterStream {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    segments: session.segments.map((segment) => ({ startedAt: segment.startedAt, endedAt: segment.endedAt })),
  };
}

/**
 * Leaderboard rows that name a viewer. The engine already ranks nobody for an
 * anonymous cheer or gift; this holds the same line on the UI side, so a row
 * without a viewer id cannot reach the page whatever the engine sends.
 */
export function attributedSupporters(entries: readonly EngineLeaderboardEntry[]): Supporter[] {
  const supporters: Supporter[] = [];
  for (const entry of entries) {
    if (typeof entry.platformUserId !== "string" || entry.platformUserId === "") {
      continue;
    }
    if (entry.platform !== SUPPORTER_PLATFORM || entry.total <= 0) {
      continue;
    }
    supporters.push({
      platformUserId: entry.platformUserId,
      userName: entry.userName,
      total: entry.total,
      events: entry.events,
    });
  }
  return supporters;
}

export function toSupporterTotals(totals: EngineViewerTotals): SupporterTotals {
  return { bits: totals.bits, cheers: totals.cheers, giftedSubs: totals.giftedSubs, gifts: totals.gifts };
}

export const NO_SUPPORT: SupporterTotals = { bits: 0, cheers: 0, giftedSubs: 0, gifts: 0 };

/**
 * The streams a viewer's per-stream totals are read for: the most recent ones
 * that were actually live. A session that never went live has nothing anyone
 * could have given during it.
 */
export function recentLiveStreams(streams: readonly SupporterStream[], count: number): SupporterStream[] {
  return streams.filter((stream) => stream.segments.length > 0).slice(0, count);
}

/** Whether `minTotal` is one the engine accepts: an integer of at least 1. */
export function isValidMinTotal(minTotal: number): boolean {
  return Number.isSafeInteger(minTotal) && minTotal >= 1;
}

/**
 * capnweb's refusal of a method the engine does not expose, e.g.
 * `'getLeaderboard' is not a function.` from an engine that predates it.
 */
const UNKNOWN_METHOD = /'([\w.]+)' is not a function/;

/** What to tell the user when an engine call for `what` failed. */
export function engineFailureMessage(what: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  if (UNKNOWN_METHOD.test(reason)) {
    return "Your engine is too old for supporter stats. Update it to the latest release to use this page.";
  }
  return `Could not load ${what} from your engine: ${reason}`;
}
