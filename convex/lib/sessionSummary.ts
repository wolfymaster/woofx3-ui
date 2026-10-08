/**
 * Validation and ordering for the engine's `session.summary` webhook.
 *
 * The shapes below must match `SessionSummaryEvent` and `SessionSummaryTotals`
 * in woofx3 shared/clients/typescript/api/webhooks.ts. They are declared here
 * rather than imported because the webhook body is untrusted JSON either way:
 * it is checked field by field before anything is stored.
 *
 * Every delivery is a whole snapshot of one session, never a delta. The engine
 * may send the same session more than once (a redelivery, or a re-summary after
 * the session's bounds moved), so the stored row is keyed on the session and
 * replaced only by a snapshot with a strictly newer `generatedAt`.
 */

export const SESSION_SUMMARY_EVENT_TYPE = "session.summary";

/** The only `schemaVersion` whose `session` and `totals` this module interprets. */
export const SESSION_SUMMARY_SCHEMA_VERSION = 1;

export interface SessionSummarySegment {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface SessionSummarySession {
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  segments: SessionSummarySegment[];
}

export interface SessionSummaryTotals {
  bits: number;
  cheers: number;
  subs: number;
  giftedSubs: number;
  follows: number;
  raids: number;
  raiders: number;
  peakViewers: number | null;
  averageViewers: number | null;
  viewerSampleMinutes: number;
}

/**
 * A summary ready to store. `body` is null when `schemaVersion` is one this
 * module does not know: the engine's contract is to keep such a row but not
 * interpret its fields, so the raw payload is kept instead.
 */
export interface ParsedSessionSummary {
  sessionId: string;
  schemaVersion: number;
  generatedAt: string;
  generatedAtMs: number;
  body: { session: SessionSummarySession; totals: SessionSummaryTotals } | null;
}

export type SessionSummaryParseResult = { ok: true; summary: ParsedSessionSummary } | { ok: false; reason: string };

const COUNT_FIELDS = ["bits", "cheers", "subs", "giftedSubs", "follows", "raids", "raiders"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableViewerFigure(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function parseSegment(value: unknown, index: number): SessionSummarySegment | string {
  if (!isRecord(value)) {
    return `session.segments[${index}] is not an object`;
  }
  if (!isNonEmptyString(value.id)) {
    return `session.segments[${index}].id is missing`;
  }
  if (!isIsoTimestamp(value.startedAt)) {
    return `session.segments[${index}].startedAt is not a timestamp`;
  }
  if (!isNullableIsoTimestamp(value.endedAt)) {
    return `session.segments[${index}].endedAt is not a timestamp or null`;
  }
  return { id: value.id, startedAt: value.startedAt, endedAt: value.endedAt };
}

function parseSession(value: unknown, sessionId: string): SessionSummarySession | string {
  if (!isRecord(value)) {
    return "session is not an object";
  }
  if (value.id !== sessionId) {
    return "session.id does not equal sessionId";
  }
  if (value.status !== "open" && value.status !== "closed") {
    return "session.status is not open or closed";
  }
  if (!isIsoTimestamp(value.startedAt)) {
    return "session.startedAt is not a timestamp";
  }
  if (!isNullableIsoTimestamp(value.endedAt)) {
    return "session.endedAt is not a timestamp or null";
  }
  if (!Array.isArray(value.segments)) {
    return "session.segments is not an array";
  }
  const segments: SessionSummarySegment[] = [];
  for (let index = 0; index < value.segments.length; index++) {
    const segment = parseSegment(value.segments[index], index);
    if (typeof segment === "string") {
      return segment;
    }
    segments.push(segment);
  }
  return { status: value.status, startedAt: value.startedAt, endedAt: value.endedAt, segments };
}

function parseTotals(value: unknown): SessionSummaryTotals | string {
  if (!isRecord(value)) {
    return "totals is not an object";
  }
  for (const field of COUNT_FIELDS) {
    if (!isCount(value[field])) {
      return `totals.${field} is not a non-negative integer`;
    }
  }
  if (!isNullableViewerFigure(value.peakViewers)) {
    return "totals.peakViewers is not a number or null";
  }
  if (!isNullableViewerFigure(value.averageViewers)) {
    return "totals.averageViewers is not a number or null";
  }
  if (!isCount(value.viewerSampleMinutes)) {
    return "totals.viewerSampleMinutes is not a non-negative integer";
  }
  return {
    bits: value.bits as number,
    cheers: value.cheers as number,
    subs: value.subs as number,
    giftedSubs: value.giftedSubs as number,
    follows: value.follows as number,
    raids: value.raids as number,
    raiders: value.raiders as number,
    peakViewers: value.peakViewers,
    averageViewers: value.averageViewers,
    viewerSampleMinutes: value.viewerSampleMinutes,
  };
}

/**
 * Checks a `session.summary` webhook body. Only the fields listed in the
 * contract are copied out, so an unexpected field (a viewer name, say) is never
 * stored.
 */
export function parseSessionSummary(data: unknown): SessionSummaryParseResult {
  if (!isRecord(data)) {
    return { ok: false, reason: "summary is not an object" };
  }
  if (data.type !== SESSION_SUMMARY_EVENT_TYPE) {
    return { ok: false, reason: `type is not ${SESSION_SUMMARY_EVENT_TYPE}` };
  }
  if (!isNonEmptyString(data.sessionId)) {
    return { ok: false, reason: "sessionId is missing" };
  }
  const schemaVersion = data.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, reason: "schemaVersion is not a positive integer" };
  }
  if (!isIsoTimestamp(data.generatedAt)) {
    return { ok: false, reason: "generatedAt is not a timestamp" };
  }

  const envelope = {
    sessionId: data.sessionId,
    schemaVersion,
    generatedAt: data.generatedAt,
    generatedAtMs: Date.parse(data.generatedAt),
  };

  if (schemaVersion !== SESSION_SUMMARY_SCHEMA_VERSION) {
    return { ok: true, summary: { ...envelope, body: null } };
  }

  const session = parseSession(data.session, data.sessionId);
  if (typeof session === "string") {
    return { ok: false, reason: session };
  }
  const totals = parseTotals(data.totals);
  if (typeof totals === "string") {
    return { ok: false, reason: totals };
  }
  return { ok: true, summary: { ...envelope, body: { session, totals } } };
}

export type SummaryWrite = "insert" | "replace" | "stale";

/**
 * What to do with an incoming snapshot given the row already stored for its
 * session, if any. Equal timestamps mean a redelivery of the same snapshot,
 * which changes nothing.
 */
export function planSummaryWrite(
  stored: { generatedAtMs: number } | null,
  incomingGeneratedAtMs: number
): SummaryWrite {
  if (stored === null) {
    return "insert";
  }
  if (incomingGeneratedAtMs > stored.generatedAtMs) {
    return "replace";
  }
  return "stale";
}

/** The stored columns for a parsed summary, apart from the instance and receipt time. */
export function summaryColumns(summary: ParsedSessionSummary, rawPayload: string) {
  const base = {
    sessionId: summary.sessionId,
    schemaVersion: summary.schemaVersion,
    generatedAt: summary.generatedAt,
    generatedAtMs: summary.generatedAtMs,
  };
  if (summary.body === null) {
    return {
      ...base,
      sessionStartedAtMs: undefined,
      session: undefined,
      totals: undefined,
      rawPayload,
    };
  }
  return {
    ...base,
    sessionStartedAtMs: Date.parse(summary.body.session.startedAt),
    session: summary.body.session,
    totals: summary.body.totals,
    rawPayload: undefined,
  };
}

/**
 * Like planSummaryWrite, for a snapshot the UI took itself of a session that
 * was still open. Such a snapshot is stamped with Convex's clock, not the
 * engine's, and can land after the engine's own summary of the session's end,
 * so it never replaces a stored summary of a closed session: that one is final.
 */
export function planOpenSnapshotWrite(
  stored: { generatedAtMs: number; session?: { status: "open" | "closed" } } | null,
  incomingGeneratedAtMs: number
): SummaryWrite {
  if (stored?.session?.status === "closed") {
    return "stale";
  }
  return planSummaryWrite(stored, incomingGeneratedAtMs);
}

interface EngineSessionRead {
  id: string;
  status: "open" | "closed";
  startedAt: string;
  endedAt: string | null;
  segments: { id: string; startedAt: string; endedAt: string | null }[];
}

interface EngineSessionTotalsRead {
  bits: number;
  cheers: number;
  subs: number;
  giftedSubs: number;
  follows: number;
  raids: number;
  raiders: number;
  peakViewers: number | null;
  averageViewers: number | null;
  viewerSampleMinutes: number;
}

/**
 * A SESSION_SUMMARY payload built from the engine's session and totals reads,
 * the same two reads the engine builds its own summary from, so it parses and
 * stores exactly like one the engine sent. Fields are copied by name so
 * anything else the engine adds to those reads stays out of the stored row.
 */
export function sessionSnapshotPayload(
  session: EngineSessionRead,
  totals: EngineSessionTotalsRead,
  generatedAt: Date
): Record<string, unknown> {
  return {
    type: SESSION_SUMMARY_EVENT_TYPE,
    sessionId: session.id,
    schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    session: {
      id: session.id,
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
  };
}

/**
 * Whether a stored summary describes a stream that is live right now.
 *
 * The engine keeps a session open after its stream goes offline, until the next
 * broadcast either continues it (a dropout inside its grace window) or replaces
 * it, so `status: "open"` says only that the engine has not closed it yet. A
 * session is in progress only while the instance is live, and, when the engine
 * has announced which session it is in, only if it is that one: an older row
 * still stored as open (its closing summary never arrived) is not live just
 * because a later stream is.
 */
export function isSummaryInProgress(
  row: { sessionId: string; session?: { status: "open" | "closed" } },
  liveState: { isLive: boolean; sessionId?: string } | null
): boolean {
  if (row.session?.status !== "open") {
    return false;
  }
  if (liveState === null || !liveState.isLive) {
    return false;
  }
  if (liveState.sessionId === undefined) {
    return true;
  }
  return liveState.sessionId === row.sessionId;
}
