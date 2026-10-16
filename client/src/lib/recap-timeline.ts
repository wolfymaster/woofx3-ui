import type { RecapClip } from "@convex/lib/recapClips";
import type { RecapMarker } from "@convex/lib/recapMarkers";
import type { RecapEvent, RecapEventKind, RecapTimelineEvents } from "@convex/lib/streamRecap";
import type { RecapClipsState } from "@/hooks/use-recap-clips";
import type { RecapMarkersState } from "@/hooks/use-recap-markers";
import type { RecapTimelineEventsState } from "@/hooks/use-recap-timeline-events";
import type { StreamRecapEngineState } from "@/hooks/use-stream-recap-engine-detail";
import type { CapabilitySupport } from "@/lib/engine-capabilities";

const MINUTE_MS = 60_000;

/**
 * Every layer of the recap timeline, in the order the toggles and lanes are
 * drawn. Viewers is the line; the rest are lanes of moments under it.
 */
export const RECAP_LAYER_IDS = ["viewers", "follow", "sub", "giftedSubs", "cheer", "raid", "clips", "markers"] as const;

export type RecapLayerId = (typeof RECAP_LAYER_IDS)[number];

export type RecapLaneId = Exclude<RecapLayerId, "viewers">;

export const RECAP_LANE_IDS: readonly RecapLaneId[] = RECAP_LAYER_IDS.filter(
  (id): id is RecapLaneId => id !== "viewers"
);

export const RECAP_LAYER_LABELS: Readonly<Record<RecapLayerId, string>> = {
  viewers: "Viewers",
  follow: "Follows",
  sub: "Subs",
  giftedSubs: "Gifted subs",
  cheer: "Cheers",
  raid: "Raids",
  clips: "Clips",
  markers: "Markers",
};

const KNOWN_LAYERS: ReadonlySet<string> = new Set(RECAP_LAYER_IDS);

/**
 * The hidden layers from a stored value, keeping only ids this page knows.
 * Hidden rather than shown ids are stored so a layer added later starts on.
 */
export function parseHiddenLayers(raw: unknown): RecapLayerId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const hidden = new Set<RecapLayerId>();
  for (const id of raw) {
    if (typeof id === "string" && KNOWN_LAYERS.has(id)) {
      hidden.add(id as RecapLayerId);
    }
  }
  return RECAP_LAYER_IDS.filter((id) => hidden.has(id));
}

/** One thing in a lane point's tooltip and table row: who or what, and how much. */
export interface LaneItem {
  label: string;
  detail: string | null;
}

/**
 * Everything one lane holds in one minute. A busy minute (a raid's follows, a
 * gift bomb) is one point with a count rather than a pile of overlapping
 * marks, so the lane stays readable however dense the stream was.
 */
export interface LanePoint {
  lane: RecapLaneId;
  /** Epoch ms of the minute. */
  t: number;
  count: number;
  /** Bits, subs gifted or raiders summed over the minute; null for lanes that carry no amount. */
  amount: number | null;
  items: LaneItem[];
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** How much one event carried, worded for its kind; null for kinds that carry nothing. */
export function eventDetail(kind: RecapEventKind, amount: number | null): string | null {
  if (amount === null) {
    return null;
  }
  switch (kind) {
    case "cheer":
      return plural(amount, "bit", "bits");
    case "giftedSubs":
      return plural(amount, "sub", "subs");
    case "raid":
      return plural(amount, "raider", "raiders");
    case "follow":
    case "sub":
      return null;
  }
}

/** The total a lane point carries, worded for its lane, or null when it carries none. */
export function laneAmountLabel(lane: RecapLaneId, amount: number | null): string | null {
  if (lane === "clips" || lane === "markers" || amount === null) {
    return null;
  }
  return eventDetail(lane, amount);
}

interface Moment {
  lane: RecapLaneId;
  at: number;
  amount: number | null;
  item: LaneItem;
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

function eventMoments(events: ReadonlyArray<RecapEvent>): Moment[] {
  const moments: Moment[] = [];
  for (const event of events) {
    moments.push({
      lane: event.kind,
      at: Date.parse(event.occurredAt),
      amount: event.amount,
      item: { label: event.userName ?? "Anonymous", detail: eventDetail(event.kind, event.amount) },
    });
  }
  return moments;
}

function clipMoments(clips: ReadonlyArray<RecapClip>): Moment[] {
  return clips.map((clip) => ({
    lane: "clips",
    at: Date.parse(clip.createdAt),
    amount: null,
    item: { label: clip.title.trim() || "Untitled clip", detail: clip.creatorName ? `by ${clip.creatorName}` : null },
  }));
}

function markerMoments(markers: ReadonlyArray<RecapMarker>): Moment[] {
  return markers.map((marker) => ({
    lane: "markers",
    at: Date.parse(marker.createdAt),
    amount: null,
    item: { label: marker.description.trim() || "Marker", detail: null },
  }));
}

/**
 * Groups the session's events, clips and markers into one point per lane per
 * minute, ordered by lane then time. A moment with no readable time is left
 * out: it has nowhere on the axis to go.
 */
export function buildLanePoints(sources: {
  events: ReadonlyArray<RecapEvent>;
  clips: ReadonlyArray<RecapClip>;
  markers: ReadonlyArray<RecapMarker>;
}): LanePoint[] {
  const moments = [...eventMoments(sources.events), ...clipMoments(sources.clips), ...markerMoments(sources.markers)]
    .filter((moment) => Number.isFinite(moment.at))
    .sort((a, b) => a.at - b.at);

  const byKey = new Map<string, LanePoint>();
  for (const moment of moments) {
    const t = floorToMinute(moment.at);
    const key = `${moment.lane}:${t}`;
    let point = byKey.get(key);
    if (!point) {
      point = { lane: moment.lane, t, count: 0, amount: null, items: [] };
      byKey.set(key, point);
    }
    point.count += 1;
    point.items.push(moment.item);
    if (moment.amount !== null) {
      point.amount = (point.amount ?? 0) + moment.amount;
    }
  }
  const laneOrder = new Map(RECAP_LANE_IDS.map((lane, index) => [lane, index]));
  return Array.from(byKey.values()).sort(
    (a, b) => (laneOrder.get(a.lane) ?? 0) - (laneOrder.get(b.lane) ?? 0) || a.t - b.t
  );
}

/** How many moments each lane holds, for the layer toggles. */
export function laneCounts(points: ReadonlyArray<LanePoint>): Record<RecapLaneId, number> {
  const counts = Object.fromEntries(RECAP_LANE_IDS.map((lane) => [lane, 0])) as Record<RecapLaneId, number>;
  for (const point of points) {
    counts[point.lane] += point.count;
  }
  return counts;
}

/**
 * The x extent every layer shares: the viewer series' extent (the live span,
 * widened to its samples) widened again to cover every lane point, so a clip
 * made in the minutes after the stream ended is still on the axis. Null when
 * there is nothing to place.
 */
export function timelineDomain(
  viewerDomain: [number, number] | null,
  points: ReadonlyArray<LanePoint>
): [number, number] | null {
  const bounds = viewerDomain ? [...viewerDomain] : [];
  for (const point of points) {
    bounds.push(point.t);
  }
  if (bounds.length === 0) {
    return null;
  }
  const start = Math.min(...bounds);
  const end = Math.max(...bounds);
  // A one-minute stream still needs an axis with some width to draw on.
  return end > start ? [start, end] : [start - MINUTE_MS, end + MINUTE_MS];
}

/** Whether a layer has something to draw, is still loading, or cannot be shown and why. */
export type RecapLayerStatus =
  | { kind: "ready"; count: number | null }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string };

const LOADING: RecapLayerStatus = { kind: "loading" };

function unavailable(reason: string): RecapLayerStatus {
  return { kind: "unavailable", reason };
}

function capabilityStatus(support: CapabilitySupport): RecapLayerStatus | null {
  switch (support) {
    case "supported":
      return null;
    case "checking":
      return LOADING;
    case "unsupported":
      return unavailable("Needs a newer engine than this instance runs.");
    case "unknown":
      return unavailable("Couldn't check what the engine supports.");
  }
}

/**
 * The viewers layer. Its problems are explained, with a retry where one can
 * help, by the engine notice under the timeline, which also covers the
 * supporters the same call loads, so the reason here only points there.
 */
export function viewerLayerStatus(
  support: CapabilitySupport,
  state: StreamRecapEngineState,
  hasViewerValues: boolean
): RecapLayerStatus {
  const gated = capabilityStatus(support);
  if (gated !== null) {
    return gated;
  }
  if (state.kind === "loading") {
    return LOADING;
  }
  if (state.kind === "loaded" && state.detail.status === "ok") {
    return hasViewerValues ? { kind: "ready", count: null } : unavailable("No viewer counts were sampled.");
  }
  return unavailable("Viewer history isn't available right now; see below.");
}

function engineEventsProblem(result: Exclude<RecapTimelineEvents, { status: "ok" }>): string {
  switch (result.status) {
    case "unregistered":
      return "This instance isn't registered with an engine.";
    case "unknown_session":
      return "The engine no longer has this session.";
    case "rejected":
      return "The engine refused this dashboard's credentials.";
    case "unreachable":
      return "The engine is offline or didn't answer.";
    case "failed":
      return `The engine couldn't load events: ${result.message}`;
  }
}

/** The status every event lane shares, since one engine call loads them all. */
export function eventLayersStatus(support: CapabilitySupport, state: RecapTimelineEventsState): RecapLayerStatus {
  const gated = capabilityStatus(support);
  if (gated !== null) {
    return gated;
  }
  if (state.kind === "loading") {
    return LOADING;
  }
  if (state.kind === "error") {
    return unavailable("Couldn't load events from the engine.");
  }
  if (state.result.status !== "ok") {
    return unavailable(engineEventsProblem(state.result));
  }
  return { kind: "ready", count: null };
}

export function clipLayerStatus(state: RecapClipsState): RecapLayerStatus {
  switch (state.kind) {
    case "loading":
      return LOADING;
    case "loaded":
      return { kind: "ready", count: state.clips.length };
    case "never_live":
      return unavailable("This session never went live.");
    case "error":
      return unavailable(state.message);
  }
}

export function markerLayerStatus(state: RecapMarkersState): RecapLayerStatus {
  if (state.kind === "loading") {
    return LOADING;
  }
  if (state.kind === "error") {
    return unavailable(state.message);
  }
  switch (state.result.status) {
    case "ok":
      return { kind: "ready", count: state.result.markers.length };
    case "never_live":
      return unavailable("This session never went live.");
    case "missing_scope":
      return unavailable("Reconnect Twitch in Settings, Integrations to let the dashboard read stream markers.");
    case "no_vod":
      return unavailable(
        "Twitch keeps markers on a stream's VOD, and this stream has none: past broadcasts may be off, or it expired."
      );
  }
}

/**
 * Every layer's status. Each event lane counts its own events, so a toggle
 * says how many follows or cheers it would show.
 */
export function recapLayerStatuses(input: {
  viewers: RecapLayerStatus;
  events: RecapLayerStatus;
  eventCounts: Record<RecapLaneId, number>;
  clips: RecapLayerStatus;
  markers: RecapLayerStatus;
}): Record<RecapLayerId, RecapLayerStatus> {
  const eventLane = (lane: RecapLaneId): RecapLayerStatus =>
    input.events.kind === "ready" ? { kind: "ready", count: input.eventCounts[lane] } : input.events;
  return {
    viewers: input.viewers,
    follow: eventLane("follow"),
    sub: eventLane("sub"),
    giftedSubs: eventLane("giftedSubs"),
    cheer: eventLane("cheer"),
    raid: eventLane("raid"),
    clips: input.clips,
    markers: input.markers,
  };
}

/** A note for when the engine's list stopped at its cap, or null when it holds every event. */
export function eventsTruncatedNote(result: RecapTimelineEvents | null): string | null {
  if (result === null || result.status !== "ok" || result.total <= result.events.length) {
    return null;
  }
  return `Events show the first ${result.events.length.toLocaleString()} of ${result.total.toLocaleString()} this stream.`;
}
