import { describe, expect, it } from "bun:test";
import type { RecapClip } from "@convex/lib/recapClips";
import type { RecapEvent } from "@convex/lib/streamRecap";
import {
  buildLanePoints,
  clipLayerStatus,
  eventLayersStatus,
  eventsTruncatedNote,
  laneCounts,
  markerLayerStatus,
  parseHiddenLayers,
  recapLayerStatuses,
  timelineDomain,
  viewerLayerStatus,
} from "./recap-timeline";

const T0 = Date.parse("2026-09-20T00:00:00.000Z");
const at = (minutes: number, seconds = 0) => new Date(T0 + minutes * 60_000 + seconds * 1000).toISOString();

function event(kind: RecapEvent["kind"], minutes: number, userName: string | null, amount: number | null = null) {
  return { occurredAt: at(minutes, 30), kind, userName, amount } satisfies RecapEvent;
}

function clip(id: string, minutes: number, title: string): RecapClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title,
    creatorName: "mod",
    viewCount: 1,
    createdAt: at(minutes),
    thumbnailUrl: "",
    durationSeconds: 30,
    offsetMs: 0,
  };
}

describe("parseHiddenLayers", () => {
  it("keeps known ids once each, in layer order", () => {
    expect(parseHiddenLayers(["markers", "viewers", "nope", "markers", 3])).toEqual(["viewers", "markers"]);
  });

  it("reads anything else as nothing hidden", () => {
    expect(parseHiddenLayers(null)).toEqual([]);
    expect(parseHiddenLayers("viewers")).toEqual([]);
  });
});

describe("buildLanePoints", () => {
  it("groups each lane's moments into one point per minute and sums the amounts", () => {
    const points = buildLanePoints({
      events: [
        event("cheer", 5, "Alice", 100),
        event("follow", 2, "Bob"),
        event("cheer", 5, null, 50),
        event("cheer", 6, "Cara", 1),
        { occurredAt: "garbage", kind: "follow", userName: "Lost", amount: null },
      ],
      clips: [clip("c1", 5, "  "), clip("c2", 5, "nice")],
      markers: [{ id: "m1", createdAt: at(1), description: "" }],
    });

    expect(points).toEqual([
      { lane: "follow", t: T0 + 2 * 60_000, count: 1, amount: null, items: [{ label: "Bob", detail: null }] },
      {
        lane: "cheer",
        t: T0 + 5 * 60_000,
        count: 2,
        amount: 150,
        items: [
          { label: "Alice", detail: "100 bits" },
          { label: "Anonymous", detail: "50 bits" },
        ],
      },
      { lane: "cheer", t: T0 + 6 * 60_000, count: 1, amount: 1, items: [{ label: "Cara", detail: "1 bit" }] },
      {
        lane: "clips",
        t: T0 + 5 * 60_000,
        count: 2,
        amount: null,
        items: [
          { label: "Untitled clip", detail: "by mod" },
          { label: "nice", detail: "by mod" },
        ],
      },
      { lane: "markers", t: T0 + 60_000, count: 1, amount: null, items: [{ label: "Marker", detail: null }] },
    ]);
  });

  it("counts every moment per lane", () => {
    const points = buildLanePoints({
      events: [event("sub", 1, "a"), event("sub", 1, "b"), event("raid", 2, "c", 40)],
      clips: [],
      markers: [],
    });
    expect(laneCounts(points)).toEqual({
      follow: 0,
      sub: 2,
      giftedSubs: 0,
      cheer: 0,
      raid: 1,
      clips: 0,
      markers: 0,
    });
  });
});

describe("timelineDomain", () => {
  const point = (minutes: number) => ({
    lane: "clips" as const,
    t: T0 + minutes * 60_000,
    count: 1,
    amount: null,
    items: [],
  });

  it("widens the viewer extent to cover every point", () => {
    expect(timelineDomain([T0, T0 + 60 * 60_000], [point(65)])).toEqual([T0, T0 + 65 * 60_000]);
  });

  it("works from points alone and gives a single instant some width", () => {
    expect(timelineDomain(null, [point(5)])).toEqual([T0 + 4 * 60_000, T0 + 6 * 60_000]);
    expect(timelineDomain(null, [])).toBeNull();
  });
});

describe("layer statuses", () => {
  it("waits on the capability check, then names what is missing", () => {
    expect(eventLayersStatus("checking", { kind: "loading" })).toEqual({ kind: "loading" });
    expect(eventLayersStatus("unsupported", { kind: "loading" })).toEqual({
      kind: "unavailable",
      reason: "Needs a newer engine than this instance runs.",
    });
    expect(
      eventLayersStatus("supported", { kind: "loaded", result: { status: "unreachable", message: "x" } }).kind
    ).toBe("unavailable");
    expect(eventLayersStatus("supported", { kind: "loaded", result: { status: "ok", events: [], total: 0 } })).toEqual({
      kind: "ready",
      count: null,
    });
  });

  it("marks viewers unavailable when the engine answered without any counts", () => {
    const loaded = {
      kind: "loaded" as const,
      detail: { status: "ok" as const, viewerSamples: [], topCheerers: [], topGifters: [] },
    };
    expect(viewerLayerStatus("supported", loaded, false).kind).toBe("unavailable");
    expect(viewerLayerStatus("supported", loaded, true)).toEqual({ kind: "ready", count: null });
  });

  it("counts clips and markers and explains a missing marker scope or VOD", () => {
    expect(clipLayerStatus({ kind: "loaded", clips: [clip("c", 1, "t")] })).toEqual({ kind: "ready", count: 1 });
    expect(markerLayerStatus({ kind: "loaded", result: { status: "missing_scope" } }).kind).toBe("unavailable");
    expect(markerLayerStatus({ kind: "loaded", result: { status: "no_vod" } }).kind).toBe("unavailable");
  });

  it("gives each event lane its own count while sharing the events status", () => {
    const counts = { follow: 3, sub: 0, giftedSubs: 1, cheer: 2, raid: 0, clips: 0, markers: 0 };
    const ready = recapLayerStatuses({
      viewers: { kind: "loading" },
      events: { kind: "ready", count: null },
      eventCounts: counts,
      clips: { kind: "loading" },
      markers: { kind: "loading" },
    });
    expect(ready.follow).toEqual({ kind: "ready", count: 3 });
    expect(ready.cheer).toEqual({ kind: "ready", count: 2 });

    const missing = recapLayerStatuses({
      viewers: { kind: "loading" },
      events: { kind: "unavailable", reason: "old engine" },
      eventCounts: counts,
      clips: { kind: "loading" },
      markers: { kind: "loading" },
    });
    expect(missing.raid).toEqual({ kind: "unavailable", reason: "old engine" });
  });
});

describe("eventsTruncatedNote", () => {
  it("says how many events the capped list left out", () => {
    const events = [event("follow", 1, "a")];
    expect(eventsTruncatedNote({ status: "ok", events, total: 1 })).toBeNull();
    expect(eventsTruncatedNote({ status: "ok", events, total: 1500 })).toBe(
      "Events show the first 1 of 1,500 this stream."
    );
    expect(eventsTruncatedNote(null)).toBeNull();
  });
});
