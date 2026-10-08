import type { Doc } from "@convex/_generated/dataModel";

/** A stored summary as the recap queries return it; `inProgress` is true only while its stream is live. */
export type SessionSummaryRow = Doc<"streamSessionSummaries"> & { inProgress: boolean };

export interface SummarySegment {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** Still live when the summary was taken; its `endedAt` is that moment, not a real end. */
  ongoing?: boolean;
}

/**
 * A summary's segments, ready to measure and draw. In a summary of an open
 * session, a segment still live when the summary was taken has no end, so it
 * is cut off at that moment: the same moment its totals describe. It is marked
 * ongoing only while the stream is in fact live; a stream that has since gone
 * down keeps that cut-off as its last known end until a newer summary lands. A
 * closed session's segments come back as stored.
 */
export function summarySegments(
  row: Pick<SessionSummaryRow, "session" | "generatedAt" | "inProgress">
): SummarySegment[] {
  const session = row.session;
  if (!session) {
    return [];
  }
  if (session.status !== "open") {
    return session.segments;
  }
  return session.segments.map((segment) => {
    if (segment.endedAt !== null) {
      return segment;
    }
    if (row.inProgress) {
      return { ...segment, endedAt: row.generatedAt, ongoing: true };
    }
    return { ...segment, endedAt: row.generatedAt };
  });
}

/**
 * Time actually live in a session: its segments added up, so the gaps a
 * session spans between brief dropouts are not counted. A segment with no end
 * contributes nothing; summarySegments gives a still-live one an end first.
 */
export function liveDurationMs(segments: ReadonlyArray<{ startedAt: string; endedAt: string | null }>): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.endedAt === null) {
      continue;
    }
    const length = Date.parse(segment.endedAt) - Date.parse(segment.startedAt);
    if (Number.isFinite(length) && length > 0) {
      total += length;
    }
  }
  return total;
}

/** "3h 05m", "42m", or "<1m" for anything under a minute. */
export function formatLiveDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "<1m";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return `${hours}h ${rest.toString().padStart(2, "0")}m`;
}

/** A viewer figure for display; null means no minute was sampled, not zero viewers. */
export function formatViewerFigure(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return Math.round(value).toLocaleString();
}

function countOf(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * Subs for one line of text, e.g. "12 subs · 5 gifted". The engine's `subs`
 * excludes gifted subs (the two add up without counting a gift twice), so they
 * are shown side by side, never one as part of the other.
 */
export function formatSubsBreakdown(subs: number, giftedSubs: number): string {
  const taken = countOf(subs, "sub", "subs");
  if (giftedSubs === 0) {
    return taken;
  }
  return `${taken} · ${giftedSubs.toLocaleString()} gifted`;
}
