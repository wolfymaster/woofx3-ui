import { describe, expect, it } from "bun:test";
import {
  classifyEngineCallError,
  isSummaryInProgress,
  type Leaderboard,
  MAX_ENGINE_ERROR_LENGTH,
  RECAP_LEADERBOARD_LIMIT,
  toRecapEngineDetail,
  toRecapTimelineEvents,
} from "./stream-recap";

function leaderboard(metric: Leaderboard["metric"], count: number): Leaderboard {
  return {
    metric,
    sessionId: "s1",
    minTotal: 1,
    entries: Array.from({ length: count }, (_, index) => ({
      platform: "twitch",
      platformUserId: `u${index}`,
      userName: `user${index}`,
      total: 100 - index,
      events: 1,
    })),
  };
}

describe("toRecapEngineDetail", () => {
  it("reports an unknown session when any answer is null", () => {
    expect(toRecapEngineDetail(null, leaderboard("bits", 1), leaderboard("giftedSubs", 1))).toEqual({
      status: "unknown_session",
    });
    expect(toRecapEngineDetail([], null, leaderboard("giftedSubs", 1)).status).toBe("unknown_session");
  });

  it("copies only the fields the recap shows", () => {
    const detail = toRecapEngineDetail(
      [
        {
          sampledAt: "2026-09-20T00:01:00.000Z",
          viewerCount: 12,
          followerTotal: 5,
          subscriberTotal: 2,
          subscriberPoints: 2,
        },
      ],
      leaderboard("bits", 1),
      leaderboard("giftedSubs", 0)
    );
    expect(detail).toEqual({
      status: "ok",
      viewerSamples: [{ sampledAt: "2026-09-20T00:01:00.000Z", viewerCount: 12 }],
      topCheerers: [{ platformUserId: "u0", userName: "user0", total: 100, events: 1 }],
      topGifters: [],
    });
  });

  it("caps each leaderboard", () => {
    const detail = toRecapEngineDetail([], leaderboard("bits", 20), leaderboard("giftedSubs", 20));
    if (detail.status !== "ok") {
      throw new Error("expected ok");
    }
    expect(detail.topCheerers).toHaveLength(RECAP_LEADERBOARD_LIMIT);
    expect(detail.topGifters).toHaveLength(RECAP_LEADERBOARD_LIMIT);
  });
});

describe("classifyEngineCallError", () => {
  it("reads the gateway's credential refusal as rejected", () => {
    expect(classifyEngineCallError(new Error("Invalid client credentials"))).toEqual({ status: "rejected" });
  });

  it("reads a failed fetch as unreachable", () => {
    expect(classifyEngineCallError(new TypeError("fetch failed"))).toEqual({
      status: "unreachable",
      message: "fetch failed",
    });
  });

  it("reads a non-2xx batch response as unreachable", () => {
    expect(classifyEngineCallError(new Error("RPC request failed: 502 Bad Gateway")).status).toBe("unreachable");
  });

  it("passes any other engine error on as failed, shortened", () => {
    const failure = classifyEngineCallError(new Error("x".repeat(500)));
    expect(failure.status).toBe("failed");
    if (failure.status !== "failed") {
      throw new Error("expected failed");
    }
    expect(failure.message.length).toBe(MAX_ENGINE_ERROR_LENGTH);
  });

  it("handles a thrown non-Error", () => {
    expect(classifyEngineCallError("boom")).toEqual({ status: "failed", message: "boom" });
  });
});

describe("toRecapTimelineEvents", () => {
  it("reports an unknown session for a null answer", () => {
    expect(toRecapTimelineEvents(null)).toEqual({ status: "unknown_session" });
  });

  it("keeps the kinds it knows and leaves out the rest", () => {
    const result = toRecapTimelineEvents({
      sessionId: "s1",
      total: 1200,
      events: [
        { occurredAt: "2026-09-20T00:01:00.000Z", kind: "cheer", userName: "Alice", amount: 100 },
        { occurredAt: "2026-09-20T00:02:00.000Z", kind: "hypeTrain", userName: null, amount: null },
        { occurredAt: "not a time", kind: "follow", userName: "Bob", amount: null },
        { occurredAt: "2026-09-20T00:03:00.000Z", kind: "follow", userName: "Cara", amount: null },
      ],
    });
    expect(result).toEqual({
      status: "ok",
      total: 1200,
      events: [
        { occurredAt: "2026-09-20T00:01:00.000Z", kind: "cheer", userName: "Alice", amount: 100 },
        { occurredAt: "2026-09-20T00:03:00.000Z", kind: "follow", userName: "Cara", amount: null },
      ],
    });
  });
});

describe("isSummaryInProgress", () => {
  const open = { sessionId: "session-1", session: { status: "open" as const } };

  it("is in progress while the instance is live in that session", () => {
    expect(isSummaryInProgress(open, { isLive: true, sessionId: "session-1" })).toBe(true);
  });

  it("is not in progress once the stream goes offline, though the engine keeps the session open", () => {
    expect(isSummaryInProgress(open, { isLive: false, sessionId: "session-1" })).toBe(false);
  });

  it("is in progress again when the next broadcast continues the same session", () => {
    expect(isSummaryInProgress(open, { isLive: false, sessionId: "session-1" })).toBe(false);
    expect(isSummaryInProgress(open, { isLive: true, sessionId: "session-1" })).toBe(true);
  });

  it("is not in progress for an open row of an older session while a later one is live", () => {
    expect(isSummaryInProgress(open, { isLive: true, sessionId: "session-2" })).toBe(false);
  });

  it("trusts the open status while live when the engine has not announced its session", () => {
    expect(isSummaryInProgress(open, { isLive: true })).toBe(true);
  });

  it("is never in progress for a closed session", () => {
    const closed = { sessionId: "session-1", session: { status: "closed" as const } };
    expect(isSummaryInProgress(closed, { isLive: true, sessionId: "session-1" })).toBe(false);
  });

  it("is not in progress without live state or a readable session", () => {
    expect(isSummaryInProgress(open, null)).toBe(false);
    expect(isSummaryInProgress({ sessionId: "session-1" }, { isLive: true, sessionId: "session-1" })).toBe(false);
  });
});
