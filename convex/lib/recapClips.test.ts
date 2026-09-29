import { describe, expect, it } from "bun:test";
import {
  CLIP_WINDOW_GRACE_MS,
  clipWindow,
  type HelixClip,
  MIN_CLIP_WINDOW_MS,
  type RecapClip,
  sortClipsByViews,
  toRecapClip,
} from "./recapClips";

const T0 = Date.parse("2026-09-27T18:00:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("clipWindow", () => {
  it("spans the first start to the last end plus the grace period", () => {
    const window = clipWindow(
      [
        { startedAt: iso(T0 + HOUR), endedAt: iso(T0 + 2 * HOUR) },
        { startedAt: iso(T0), endedAt: iso(T0 + 30 * 60_000) },
      ],
      T0 + 10 * HOUR
    );
    expect(window).toEqual({ startedAtMs: T0, endedAtMs: T0 + 2 * HOUR + CLIP_WINDOW_GRACE_MS });
  });

  it("never reaches past now", () => {
    const window = clipWindow([{ startedAt: iso(T0), endedAt: iso(T0 + HOUR) }], T0 + HOUR + 60_000);
    expect(window?.endedAtMs).toBe(T0 + HOUR + 60_000);
  });

  it("runs an open segment until now", () => {
    const window = clipWindow([{ startedAt: iso(T0), endedAt: null }], T0 + HOUR);
    expect(window).toEqual({ startedAtMs: T0, endedAtMs: T0 + HOUR });
  });

  it("widens a zero-length window to the minimum", () => {
    const window = clipWindow([{ startedAt: iso(T0), endedAt: iso(T0) }], T0);
    expect(window).toEqual({ startedAtMs: T0, endedAtMs: T0 + MIN_CLIP_WINDOW_MS });
  });

  it("is null for a session that never went live", () => {
    expect(clipWindow([], T0)).toBeNull();
  });

  it("skips unparseable segments", () => {
    const window = clipWindow(
      [
        { startedAt: "garbage", endedAt: iso(T0 + 5 * HOUR) },
        { startedAt: iso(T0), endedAt: iso(T0 + HOUR) },
      ],
      T0 + 10 * HOUR
    );
    expect(window).toEqual({ startedAtMs: T0, endedAtMs: T0 + HOUR + CLIP_WINDOW_GRACE_MS });
  });
});

function helixClip(overrides: Partial<HelixClip> = {}): HelixClip {
  return {
    id: "c1",
    url: "https://clips.twitch.tv/c1",
    title: "Big play",
    creator_name: "mod",
    view_count: 3,
    created_at: iso(T0 + 90_000),
    thumbnail_url: "https://example.test/thumb.jpg",
    duration: 29.8,
    vod_offset: null,
    ...overrides,
  };
}

describe("toRecapClip", () => {
  const window = { startedAtMs: T0, endedAtMs: T0 + HOUR };

  it("maps Helix fields and measures the offset from going live", () => {
    expect(toRecapClip(helixClip(), window)).toEqual({
      id: "c1",
      url: "https://clips.twitch.tv/c1",
      title: "Big play",
      creatorName: "mod",
      viewCount: 3,
      createdAt: iso(T0 + 90_000),
      thumbnailUrl: "https://example.test/thumb.jpg",
      durationSeconds: 29.8,
      offsetMs: 90_000,
    });
  });

  it("prefers the VOD offset when Twitch has one", () => {
    expect(toRecapClip(helixClip({ vod_offset: 3725 }), window).offsetMs).toBe(3_725_000);
  });

  it("clamps an offset before going live to zero", () => {
    expect(toRecapClip(helixClip({ created_at: iso(T0 - 5_000) }), window).offsetMs).toBe(0);
  });
});

function recapClip(id: string, viewCount: number, offsetMs: number): RecapClip {
  return { ...toRecapClip(helixClip({ id }), { startedAtMs: T0, endedAtMs: T0 }), viewCount, offsetMs };
}

describe("sortClipsByViews", () => {
  it("orders by views, then earliest, then id, dropping repeated ids", () => {
    const sorted = sortClipsByViews([
      recapClip("b", 5, 100),
      recapClip("a", 5, 100),
      recapClip("c", 9, 500),
      recapClip("d", 5, 50),
      recapClip("c", 1, 0),
    ]);
    expect(sorted.map((clip) => clip.id)).toEqual(["c", "d", "a", "b"]);
  });
});
