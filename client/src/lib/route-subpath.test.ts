import { describe, expect, test } from "bun:test";
import { decodeSegment, subPathSegments } from "@/lib/route-subpath";

describe("subPathSegments", () => {
  test("a page's own route selects nothing", () => {
    expect(subPathSegments("/stream/alerts", "/stream/alerts")).toEqual([]);
  });

  test("a trailing slash selects nothing", () => {
    expect(subPathSegments("/stream/alerts/", "/stream/alerts")).toEqual([]);
  });

  test("every segment below the base is one step of the path", () => {
    expect(subPathSegments("/stream/alerts/twitch/subscription/gift", "/stream/alerts")).toEqual([
      "twitch",
      "subscription",
      "gift",
    ]);
  });

  test("segments are decoded", () => {
    expect(subPathSegments("/stream/counters/hype%20train", "/stream/counters")).toEqual(["hype train"]);
  });

  test("another page's location selects nothing", () => {
    expect(subPathSegments("/stream/commands", "/stream/alerts")).toEqual([]);
  });

  test("a base that is only a prefix of the segment does not match", () => {
    expect(subPathSegments("/stream/alerts-history/abc", "/stream/alerts")).toEqual([]);
  });
});

describe("decodeSegment", () => {
  test("invalid percent-encoding is kept as written", () => {
    expect(decodeSegment("100%")).toBe("100%");
  });
});
