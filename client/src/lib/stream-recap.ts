import type { RecapSupporter, RecapViewerSample } from "@convex/lib/streamRecap";

const MINUTE_MS = 60_000;

interface Segment {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface TimelineSegment {
  id: string;
  startedAt: string;
  endedAt: string;
  /** Distance from the first segment's start, as a percentage of the whole span. */
  offsetPercent: number;
  widthPercent: number;
}

/**
 * Places each live segment along the span from the first going-live to the
 * last going-down, so the gaps between them read as time offline. A segment
 * with no end is left out, as `liveDurationMs` leaves it out of the total.
 */
export function segmentTimeline(segments: ReadonlyArray<Segment>): TimelineSegment[] {
  const closed = segments
    .filter((segment): segment is Segment & { endedAt: string } => segment.endedAt !== null)
    .map((segment) => ({ segment, start: Date.parse(segment.startedAt), end: Date.parse(segment.endedAt) }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((a, b) => a.start - b.start);
  if (closed.length === 0) {
    return [];
  }
  const spanStart = closed[0].start;
  const spanEnd = Math.max(...closed.map(({ end }) => end));
  const span = spanEnd - spanStart;
  return closed.map(({ segment, start, end }) => ({
    id: segment.id,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    offsetPercent: span === 0 ? 0 : ((start - spanStart) / span) * 100,
    widthPercent: span === 0 ? 100 : ((end - start) / span) * 100,
  }));
}

export interface ViewerPoint {
  /** Epoch ms of the sampled minute. */
  t: number;
  /** Null where the minute was not sampled or its read failed: drawn as a gap, never as zero. */
  viewers: number | null;
  /** A value with no sampled neighbour on either side, which a line alone would not draw. */
  isolated: boolean;
}

export interface ViewerSeries {
  points: ViewerPoint[];
  /** The x extent: the live span when known, widened to cover every sample. */
  domain: [number, number] | null;
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/**
 * Turns the engine's minute samples into chart points. A missing minute is
 * not zero viewers, so wherever consecutive samples are more than a minute
 * apart one null point is inserted just after the earlier sample; that breaks
 * the line without inventing a value, and keeps the point count proportional
 * to the samples rather than to the stream's length.
 */
export function buildViewerSeries(
  samples: ReadonlyArray<RecapViewerSample>,
  segments: ReadonlyArray<Segment>
): ViewerSeries {
  const byMinute = new Map<number, number | null>();
  for (const sample of samples) {
    const parsed = Date.parse(sample.sampledAt);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    byMinute.set(floorToMinute(parsed), sample.viewerCount);
  }
  const minutes = Array.from(byMinute.keys()).sort((a, b) => a - b);

  const points: ViewerPoint[] = [];
  for (const t of minutes) {
    const previous = points.at(-1);
    if (previous && t - previous.t > MINUTE_MS) {
      points.push({ t: previous.t + MINUTE_MS, viewers: null, isolated: false });
    }
    points.push({ t, viewers: byMinute.get(t) ?? null, isolated: false });
  }
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const before = points[index - 1];
    const after = points[index + 1];
    const hasNeighbour = (neighbour: ViewerPoint | undefined) =>
      neighbour !== undefined && neighbour.viewers !== null && Math.abs(neighbour.t - point.t) === MINUTE_MS;
    point.isolated = point.viewers !== null && !hasNeighbour(before) && !hasNeighbour(after);
  }

  const bounds: number[] = [];
  for (const segment of segments) {
    bounds.push(floorToMinute(Date.parse(segment.startedAt)));
    if (segment.endedAt !== null) {
      bounds.push(floorToMinute(Date.parse(segment.endedAt)));
    }
  }
  if (minutes.length > 0) {
    bounds.push(minutes[0], minutes[minutes.length - 1]);
  }
  const finite = bounds.filter(Number.isFinite);
  const domain: [number, number] | null = finite.length === 0 ? null : [Math.min(...finite), Math.max(...finite)];
  return { points, domain };
}

/** Twitch rejects announcements longer than this. */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

/** Supporters named per leaderboard in the thank-you line. */
export const THANK_YOU_PER_LIST = 3;

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function mentions(supporters: ReadonlyArray<RecapSupporter>, unit: (total: number) => string): string[] {
  return supporters
    .filter((supporter) => supporter.userName !== null && supporter.userName.trim() !== "")
    .map((supporter) => `@${supporter.userName?.trim()} (${unit(supporter.total)})`);
}

function giftUnit(total: number): string {
  return total === 1 ? "1 sub" : `${formatCount(total)} subs`;
}

function bitsUnit(total: number): string {
  return total === 1 ? "1 bit" : `${formatCount(total)} bits`;
}

function compose(gifters: string[], cheerers: string[]): string {
  const parts = ["Thank you for an amazing stream!"];
  if (gifters.length > 0) {
    parts.push(`Top gifters: ${gifters.join(", ")}.`);
  }
  if (cheerers.length > 0) {
    parts.push(`Top cheerers: ${cheerers.join(", ")}.`);
  }
  parts.push("You all made it happen <3");
  return parts.join(" ");
}

/**
 * A chat-ready thank-you naming the top gifters and cheerers, or null when no
 * supporter has a name to mention. Only named supporters appear: the engine
 * never attributes anonymous gifts or cheers, and a nameless id would mean
 * nothing in chat. When the line would exceed `maxLength`, the lowest-ranked
 * name of the longer list is dropped until it fits.
 */
export function buildThankYouMessage(
  supporters: { gifters: ReadonlyArray<RecapSupporter>; cheerers: ReadonlyArray<RecapSupporter> },
  maxLength: number = MAX_CHAT_MESSAGE_LENGTH
): string | null {
  const gifters = mentions(supporters.gifters, giftUnit).slice(0, THANK_YOU_PER_LIST);
  const cheerers = mentions(supporters.cheerers, bitsUnit).slice(0, THANK_YOU_PER_LIST);
  while (gifters.length + cheerers.length > 0) {
    const message = compose(gifters, cheerers);
    if (message.length <= maxLength) {
      return message;
    }
    if (gifters.length >= cheerers.length) {
      gifters.pop();
    } else {
      cheerers.pop();
    }
  }
  return null;
}
