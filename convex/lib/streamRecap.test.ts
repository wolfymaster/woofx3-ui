import { describe, expect, it } from "bun:test";
import { type Leaderboard, RECAP_LEADERBOARD_LIMIT, toRecapEngineDetail } from "./streamRecap";

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
