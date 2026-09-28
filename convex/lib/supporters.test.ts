import { describe, expect, it } from "bun:test";
import {
  attributedSupporters,
  type EngineLeaderboardEntry,
  isValidMinTotal,
  recentLiveStreams,
  type SupporterStream,
  toSupporterStream,
} from "./supporters";

function entry(overrides: Partial<EngineLeaderboardEntry> = {}): EngineLeaderboardEntry {
  return { platform: "twitch", platformUserId: "100", userName: "Alice", total: 500, events: 3, ...overrides };
}

function stream(id: string, live: boolean): SupporterStream {
  return {
    id,
    status: "closed",
    startedAt: "2026-09-20T00:00:00.000Z",
    endedAt: "2026-09-20T03:00:00.000Z",
    segments: live ? [{ startedAt: "2026-09-20T00:00:00.000Z", endedAt: "2026-09-20T03:00:00.000Z" }] : [],
  };
}

describe("attributedSupporters", () => {
  it("keeps viewers in the engine's order", () => {
    const supporters = attributedSupporters([entry(), entry({ platformUserId: "200", userName: null, total: 100 })]);
    expect(supporters).toEqual([
      { platformUserId: "100", userName: "Alice", total: 500, events: 3 },
      { platformUserId: "200", userName: null, total: 100, events: 3 },
    ]);
  });

  it("drops rows that name no viewer, so anonymous support never ranks", () => {
    expect(attributedSupporters([entry({ platformUserId: "" })])).toEqual([]);
  });

  it("drops other platforms and empty totals", () => {
    expect(attributedSupporters([entry({ platform: "youtube" }), entry({ total: 0 })])).toEqual([]);
  });
});

describe("toSupporterStream", () => {
  it("keeps what the page shows and drops segment ids", () => {
    const converted = toSupporterStream({
      id: "s1",
      status: "open",
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: null,
      segments: [{ id: "seg", startedAt: "2026-09-20T00:00:00.000Z", endedAt: null }],
    });
    expect(converted.segments).toEqual([{ startedAt: "2026-09-20T00:00:00.000Z", endedAt: null }]);
  });
});

describe("recentLiveStreams", () => {
  it("skips sessions that never went live and keeps the newest", () => {
    const streams = [stream("a", true), stream("b", false), stream("c", true), stream("d", true)];
    expect(recentLiveStreams(streams, 2).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("isValidMinTotal", () => {
  it("accepts whole numbers of at least 1", () => {
    expect(isValidMinTotal(1)).toBe(true);
    expect(isValidMinTotal(25)).toBe(true);
    expect(isValidMinTotal(0)).toBe(false);
    expect(isValidMinTotal(2.5)).toBe(false);
    expect(isValidMinTotal(Number.NaN)).toBe(false);
  });
});
