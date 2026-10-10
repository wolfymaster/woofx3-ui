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

/** Must match `StreamSessionEventKind` in woofx3 shared/clients/typescript/api/api.ts. */
export const RECAP_EVENT_KINDS = ["follow", "sub", "giftedSubs", "cheer", "raid"] as const;

export type RecapEventKind = (typeof RECAP_EVENT_KINDS)[number];

const KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set(RECAP_EVENT_KINDS);

/** One counted event of a session, as the engine serves it. */
export interface StreamSessionEvent {
  occurredAt: string;
  kind: RecapEventKind;
  userName: string | null;
  amount: number | null;
}

export interface StreamSessionEventsQuery {
  sessionId: string;
  limit?: number;
}

export interface StreamSessionEvents {
  sessionId: string;
  events: StreamSessionEvent[];
  total: number;
}

export interface StreamRecapEngineApi extends EngineApi {
  getLeaderboard(query: LeaderboardQuery): Promise<Leaderboard | null>;
  getStreamSessionGauges(sessionId: string): Promise<StreamGaugeSample[] | null>;
  getStreamSessionEvents(query: StreamSessionEventsQuery): Promise<StreamSessionEvents | null>;
}

/** Most events a recap asks for: the engine's own cap, so one call carries the whole timeline when it fits. */
export const RECAP_EVENT_LIMIT = 1000;

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
 * What the recap page gets from the engine. Every status but `ok` still leaves
 * the recap rendering from the stored summary:
 * - `rejected`: the engine refused this instance's client credentials, so
 *   re-registering the engine, not retrying, is the fix.
 * - `unreachable`: no answer, or an HTTP failure before any RPC ran.
 * - `failed`: the engine answered with an error of its own.
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
  | { status: "rejected" }
  | { status: "unreachable"; message: string }
  | { status: "failed"; message: string };

export type EngineCallFailure = Extract<StreamRecapEngineDetail, { status: "rejected" | "unreachable" | "failed" }>;

export interface RecapEvent {
  occurredAt: string;
  kind: RecapEventKind;
  userName: string | null;
  amount: number | null;
}

/**
 * A session's events for the recap timeline. `total` counts every event the
 * engine has for the session, so the page can say how many `events` leaves
 * out when it hit `RECAP_EVENT_LIMIT`.
 */
export type RecapTimelineEvents =
  | { status: "ok"; events: RecapEvent[]; total: number }
  | { status: "unregistered" }
  | { status: "unknown_session" }
  | EngineCallFailure;

/** Longest engine error text passed on to the page. */
export const MAX_ENGINE_ERROR_LENGTH = 200;

// Must match the error woofx3 api/src/gateway.ts throws from authenticate().
const INVALID_CREDENTIALS_MESSAGE = "Invalid client credentials";

// capnweb's HTTP batch transport throws this prefix when the POST itself gets a
// non-2xx answer, before any RPC in the batch ran.
const HTTP_BATCH_FAILURE_PREFIX = "RPC request failed:";

function shorten(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ENGINE_ERROR_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_ENGINE_ERROR_LENGTH - 1)}…`;
}

/**
 * Sorts a thrown engine call into what the page can say about it. fetch throws
 * a TypeError when the host cannot be reached at all, which is the common case
 * for an engine that is switched off.
 */
export function classifyEngineCallError(error: unknown): EngineCallFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(INVALID_CREDENTIALS_MESSAGE)) {
    return { status: "rejected" };
  }
  if (error instanceof TypeError || message.startsWith(HTTP_BATCH_FAILURE_PREFIX)) {
    return { status: "unreachable", message: shorten(message) };
  }
  return { status: "failed", message: shorten(message) };
}

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

/**
 * Builds the timeline payload from the engine's answer, copying only the
 * fields the page shows. A kind this dashboard does not know is left out
 * rather than refused: a newer engine may count more kinds than this page can
 * draw, and the rest of the timeline is still right without them.
 */
export function toRecapTimelineEvents(answer: StreamSessionEvents | null): RecapTimelineEvents {
  if (answer === null) {
    return { status: "unknown_session" };
  }
  const events: RecapEvent[] = [];
  for (const event of answer.events) {
    if (!KNOWN_EVENT_KINDS.has(event.kind) || !Number.isFinite(Date.parse(event.occurredAt))) {
      continue;
    }
    events.push({
      occurredAt: event.occurredAt,
      kind: event.kind as RecapEventKind,
      userName: event.userName,
      amount: event.amount,
    });
  }
  return { status: "ok", events, total: Math.max(answer.total, answer.events.length) };
}
