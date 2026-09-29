import { describe, expect, it } from "bun:test";
import type { SupporterStream } from "@convex/lib/supporters";
import { ConvexError } from "convex/values";
import {
  formatMetricEvents,
  formatMetricTotal,
  LIFETIME,
  matchSupporters,
  parseMinTotal,
  parseRangeValue,
  rangeSessionId,
  rangeValue,
  rankSupporters,
  reconcileRange,
  streamLabel,
  supporterErrorText,
  supporterName,
  thankYouLine,
} from "./supporters";

function supporter(platformUserId: string, total: number, userName: string | null = platformUserId) {
  return { platformUserId, userName, total, events: 1 };
}

function stream(overrides: Partial<SupporterStream> = {}): SupporterStream {
  return {
    id: "s1",
    status: "closed",
    startedAt: "2026-09-20T12:00:00.000Z",
    endedAt: "2026-09-20T16:00:00.000Z",
    segments: [{ startedAt: "2026-09-20T12:00:00.000Z", endedAt: "2026-09-20T15:05:00.000Z" }],
    ...overrides,
  };
}

describe("range values", () => {
  it("round-trips lifetime and a stream", () => {
    expect(parseRangeValue(rangeValue(LIFETIME))).toEqual(LIFETIME);
    const range = { kind: "stream" as const, sessionId: "abc:1" };
    expect(parseRangeValue(rangeValue(range))).toEqual(range);
  });

  it("reads anything unrecognised as lifetime", () => {
    expect(parseRangeValue("stream:")).toEqual(LIFETIME);
    expect(parseRangeValue("bogus")).toEqual(LIFETIME);
  });

  it("asks for lifetime with no session id", () => {
    expect(rangeSessionId(LIFETIME)).toBeUndefined();
    expect(rangeSessionId({ kind: "stream", sessionId: "s1" })).toBe("s1");
  });
});

describe("reconcileRange", () => {
  it("keeps a stream that is still listed", () => {
    const range = { kind: "stream" as const, sessionId: "s1" };
    expect(reconcileRange(range, [stream()])).toBe(range);
  });

  it("falls back to lifetime when the stream is gone", () => {
    expect(reconcileRange({ kind: "stream", sessionId: "merged" }, [stream()])).toEqual(LIFETIME);
  });

  it("leaves lifetime alone", () => {
    expect(reconcileRange(LIFETIME, [])).toBe(LIFETIME);
  });
});

describe("parseMinTotal", () => {
  it("treats empty as no filter", () => {
    expect(parseMinTotal("  ")).toBe(1);
  });

  it("accepts whole numbers of at least 1", () => {
    expect(parseMinTotal("5")).toBe(5);
    expect(parseMinTotal(" 100 ")).toBe(100);
  });

  it("rejects anything else", () => {
    expect(parseMinTotal("0")).toBeNull();
    expect(parseMinTotal("-2")).toBeNull();
    expect(parseMinTotal("2.5")).toBeNull();
    expect(parseMinTotal("five")).toBeNull();
    expect(parseMinTotal("99999999999999999999")).toBeNull();
  });
});

describe("rankSupporters", () => {
  it("shares a rank between equal totals and skips past them", () => {
    const ranked = rankSupporters([supporter("a", 500), supporter("b", 300), supporter("c", 300), supporter("d", 100)]);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it("is empty for nobody", () => {
    expect(rankSupporters([])).toEqual([]);
  });
});

describe("supporterName and matchSupporters", () => {
  it("names a viewer whose events carried no name", () => {
    expect(supporterName({ platformUserId: "42", userName: null })).toBe("Viewer 42");
  });

  it("matches names ignoring case and a leading @", () => {
    const list = [supporter("1", 5, "BigCheerer"), supporter("2", 4, "smallfry"), supporter("3", 3, null)];
    expect(matchSupporters(list, "@cheer").map((s) => s.platformUserId)).toEqual(["1"]);
    expect(matchSupporters(list, "  ")).toEqual([]);
  });
});

describe("formatting totals", () => {
  it("pluralises", () => {
    expect(formatMetricTotal("bits", 1)).toBe("1 bit");
    expect(formatMetricTotal("bits", 1500)).toBe("1,500 bits");
    expect(formatMetricTotal("giftedSubs", 1)).toBe("1 gifted sub");
    expect(formatMetricEvents("bits", 2)).toBe("2 cheers");
    expect(formatMetricEvents("giftedSubs", 1)).toBe("1 gift");
  });
});

describe("thankYouLine", () => {
  it("thanks for one stream", () => {
    expect(thankYouLine("Alice", { bits: 500 }, "stream")).toBe(
      "Thank you @Alice for the 500 bits during the stream! You made it a great one."
    );
  });

  it("thanks for everything, naming both kinds of support", () => {
    expect(thankYouLine("@Alice", { bits: 1500, giftedSubs: 1 }, "lifetime")).toBe(
      "Thank you @Alice for the 1,500 bits and 1 gifted sub you have sent my way! Your support means so much."
    );
  });

  it("leaves out what they did not give", () => {
    expect(thankYouLine("Bob", { bits: 0, giftedSubs: 10 }, "stream")).toBe(
      "Thank you @Bob for the 10 gifted subs during the stream! You made it a great one."
    );
  });

  it("has nothing to say for nothing given", () => {
    expect(thankYouLine("Bob", { bits: 0, giftedSubs: 0 }, "lifetime")).toBeNull();
  });
});

describe("streamLabel", () => {
  it("shows the date and time live", () => {
    expect(streamLabel(stream())).toBe("Sep 20, 2026 · 3h 05m");
  });

  it("marks a stream that is live now", () => {
    const live = stream({
      status: "open",
      endedAt: null,
      segments: [{ startedAt: "2026-09-20T12:00:00.000Z", endedAt: null }],
    });
    expect(streamLabel(live)).toBe("Sep 20, 2026 · live now");
  });

  it("marks a session that never went live", () => {
    expect(streamLabel(stream({ segments: [] }))).toBe("Sep 20, 2026 · never live");
  });
});

describe("supporterErrorText", () => {
  it("reads a ConvexError's message from its data", () => {
    expect(supporterErrorText(new ConvexError("Not a member"))).toBe("Not a member");
  });

  it("falls back to an Error's message", () => {
    expect(supporterErrorText(new Error("boom"))).toBe("boom");
  });
});
