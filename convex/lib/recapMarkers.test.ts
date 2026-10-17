import { describe, expect, it } from "bun:test";
import {
  type HelixMarker,
  type HelixVideo,
  markersFromHelix,
  parseHelixDuration,
  RECAP_MARKER_MAX_VIDEOS,
  toRecapMarkers,
  videosInWindow,
} from "./recapMarkers";

const T0 = Date.parse("2026-09-27T18:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const WINDOW = { startedAtMs: T0, endedAtMs: T0 + 3 * HOUR };

function video(id: string, startMs: number, duration: string): HelixVideo {
  return { id, created_at: iso(startMs), duration };
}

function marker(id: string, atMs: number, description = ""): HelixMarker {
  return { id, created_at: iso(atMs), description, position_seconds: 0 };
}

describe("parseHelixDuration", () => {
  it("reads hours, minutes and seconds in any combination", () => {
    expect(parseHelixDuration("3h8m33s")).toBe(((3 * 60 + 8) * 60 + 33) * 1000);
    expect(parseHelixDuration("45m")).toBe(45 * 60_000);
    expect(parseHelixDuration("12s")).toBe(12_000);
  });

  it("is null for anything else", () => {
    expect(parseHelixDuration("")).toBeNull();
    expect(parseHelixDuration("1d")).toBeNull();
    expect(parseHelixDuration("PT1H")).toBeNull();
  });
});

describe("videosInWindow", () => {
  it("keeps VODs that overlap the window, oldest first", () => {
    const videos = [
      video("later", T0 + 2 * HOUR, "30m"),
      video("before", T0 - 5 * HOUR, "1h"),
      video("spanning-start", T0 - 10 * 60_000, "1h"),
      video("after", T0 + 4 * HOUR, "1h"),
      video("broken", T0, "soon"),
    ];
    expect(videosInWindow(videos, WINDOW).map((v) => v.id)).toEqual(["spanning-start", "later"]);
  });

  it("reads at most RECAP_MARKER_MAX_VIDEOS of them", () => {
    const videos = Array.from({ length: RECAP_MARKER_MAX_VIDEOS + 2 }, (_, index) =>
      video(`v${index}`, T0 + index * 60_000, "1m")
    );
    expect(videosInWindow(videos, WINDOW)).toHaveLength(RECAP_MARKER_MAX_VIDEOS);
  });
});

describe("markersFromHelix", () => {
  it("flattens every video's markers", () => {
    const body = {
      data: [
        {
          user_id: "1",
          videos: [
            { video_id: "v1", markers: [marker("a", T0)] },
            { video_id: "v2", markers: [marker("b", T0), marker("c", T0)] },
          ],
        },
      ],
    };
    expect(markersFromHelix(body).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("throws on an answer with no data list", () => {
    expect(() => markersFromHelix({})).toThrow("unexpected shape");
  });
});

describe("toRecapMarkers", () => {
  const vod = video("v1", T0, "3h");

  it("keeps markers inside the window once each, oldest first", () => {
    const markers = toRecapMarkers(
      [
        { video: vod, marker: marker("late", T0 + 2 * HOUR, "boss fight") },
        { video: vod, marker: marker("early", T0 + HOUR, "start") },
        { video: vod, marker: marker("early", T0 + HOUR, "start") },
        { video: vod, marker: marker("outside", T0 + 5 * HOUR) },
      ],
      WINDOW
    );
    expect(markers).toEqual([
      { id: "early", createdAt: iso(T0 + HOUR), description: "start" },
      { id: "late", createdAt: iso(T0 + 2 * HOUR), description: "boss fight" },
    ]);
  });

  it("places a marker with no readable time from its VOD's start", () => {
    const markers = toRecapMarkers(
      [{ video: vod, marker: { id: "m", created_at: "", description: "", position_seconds: 90 } }],
      WINDOW
    );
    expect(markers).toEqual([{ id: "m", createdAt: iso(T0 + 90_000), description: "" }]);
  });
});
