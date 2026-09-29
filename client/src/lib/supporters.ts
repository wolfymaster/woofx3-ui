import type { Supporter, SupporterMetric, SupporterStream } from "@convex/lib/supporters";
import { ConvexError } from "convex/values";
import { formatLiveDuration, liveDurationMs } from "@/lib/session-summary";

/** What a leaderboard ranks over: all time, or one stream. */
export type SupporterRange = { kind: "lifetime" } | { kind: "stream"; sessionId: string };

export const LIFETIME: SupporterRange = { kind: "lifetime" };

const STREAM_VALUE_PREFIX = "stream:";

/** A range as a select value. */
export function rangeValue(range: SupporterRange): string {
  return range.kind === "lifetime" ? "lifetime" : `${STREAM_VALUE_PREFIX}${range.sessionId}`;
}

/** The range a select value names; anything unrecognised is all time. */
export function parseRangeValue(value: string): SupporterRange {
  if (value.startsWith(STREAM_VALUE_PREFIX) && value.length > STREAM_VALUE_PREFIX.length) {
    return { kind: "stream", sessionId: value.slice(STREAM_VALUE_PREFIX.length) };
  }
  return LIFETIME;
}

/** The `sessionId` a leaderboard read takes; undefined asks for lifetime. */
export function rangeSessionId(range: SupporterRange): string | undefined {
  return range.kind === "stream" ? range.sessionId : undefined;
}

/**
 * The range to keep once the stream list is known. A stream split or merged
 * away since it was picked is no longer in the list, and the engine would
 * refuse it, so the page falls back to all time instead of showing an error
 * for a choice the user did not just make.
 */
export function reconcileRange(range: SupporterRange, streams: readonly SupporterStream[]): SupporterRange {
  if (range.kind === "lifetime") {
    return range;
  }
  return streams.some((stream) => stream.id === range.sessionId) ? range : LIFETIME;
}

/**
 * The minimum a leaderboard filters on, from what was typed. Empty means no
 * filter (the engine's floor of 1); null means the text is not a whole number
 * of at least 1, and the page keeps the last valid one.
 */
export function parseMinTotal(input: string): number | null {
  const text = input.trim();
  if (text === "") {
    return 1;
  }
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export interface RankedSupporter extends Supporter {
  /** 1-based. Equal totals share a rank and the next rank skips past them: 1, 2, 2, 4. */
  rank: number;
}

/** Ranks in the order the engine sent, which is highest total first. */
export function rankSupporters(supporters: readonly Supporter[]): RankedSupporter[] {
  const ranked: RankedSupporter[] = [];
  supporters.forEach((supporter, index) => {
    const previous = ranked[index - 1];
    const rank = previous !== undefined && previous.total === supporter.total ? previous.rank : index + 1;
    ranked.push({ ...supporter, rank });
  });
  return ranked;
}

/** The name to show for a supporter whose events carried none. */
export function supporterName(supporter: { userName: string | null; platformUserId: string }): string {
  return supporter.userName ?? `Viewer ${supporter.platformUserId}`;
}

/** Supporters whose name contains the query, ignoring case and a leading @. */
export function matchSupporters<T extends { userName: string | null }>(supporters: readonly T[], query: string): T[] {
  const needle = query.trim().replace(/^@/, "").toLowerCase();
  if (needle === "") {
    return [];
  }
  return supporters.filter((supporter) => (supporter.userName ?? "").toLowerCase().includes(needle));
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** "1,500 bits" or "3 gifted subs". */
export function formatMetricTotal(metric: SupporterMetric, total: number): string {
  return metric === "bits" ? plural(total, "bit", "bits") : plural(total, "gifted sub", "gifted subs");
}

export const METRIC_LABELS: Record<SupporterMetric, string> = { bits: "Bits", giftedSubs: "Gifted subs" };

/** The events behind a total: "4 cheers" or "2 gifts". */
export function formatMetricEvents(metric: SupporterMetric, events: number): string {
  return metric === "bits" ? plural(events, "cheer", "cheers") : plural(events, "gift", "gifts");
}

/**
 * A line to paste into chat thanking a supporter. `scope` says what the
 * amounts cover, which changes how the thanks reads. Null when there is
 * nothing to thank them for.
 */
export function thankYouLine(
  name: string,
  amounts: { bits?: number; giftedSubs?: number },
  scope: "lifetime" | "stream"
): string | null {
  const parts: string[] = [];
  if ((amounts.bits ?? 0) > 0) {
    parts.push(formatMetricTotal("bits", amounts.bits ?? 0));
  }
  if ((amounts.giftedSubs ?? 0) > 0) {
    parts.push(formatMetricTotal("giftedSubs", amounts.giftedSubs ?? 0));
  }
  if (parts.length === 0) {
    return null;
  }
  const mention = `@${name.trim().replace(/^@/, "")}`;
  const what = parts.join(" and ");
  if (scope === "stream") {
    return `Thank you ${mention} for the ${what} during the stream! You made it a great one.`;
  }
  return `Thank you ${mention} for the ${what} you have sent my way! Your support means so much.`;
}

const STREAM_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Sep 27, 2026 · 3h 05m", "Sep 27, 2026 · live now", or "... · never live". */
export function streamLabel(stream: SupporterStream): string {
  const started = Date.parse(stream.startedAt);
  const date = Number.isFinite(started) ? STREAM_DATE.format(new Date(started)) : stream.startedAt;
  if (stream.status === "open" && stream.segments.some((segment) => segment.endedAt === null)) {
    return `${date} · live now`;
  }
  if (stream.segments.length === 0) {
    return `${date} · never live`;
  }
  return `${date} · ${formatLiveDuration(liveDurationMs(stream.segments))}`;
}

/** What a failed Convex call says to the user; a ConvexError carries its message as data. */
export function supporterErrorText(err: unknown): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : "Something went wrong.";
  }
  return err instanceof Error ? err.message : String(err);
}
