import { describe, expect, test } from "bun:test";
import { listenerTakes, type StreamListener, streamTypesUnion } from "./stream-listeners";

function listener(types: string[]): StreamListener {
  return { types: new Set(types), callback: () => {} };
}

describe("streamTypesUnion", () => {
  test("unions every listener's types, unique and sorted", () => {
    const union = streamTypesUnion([
      listener(["channel.follow", "channel.cheer"]),
      listener(["channel.ad_break.begin", "channel.follow"]),
    ]);
    expect(union).toEqual(["channel.ad_break.begin", "channel.cheer", "channel.follow"]);
  });

  test("is empty without listeners", () => {
    expect(streamTypesUnion([])).toEqual([]);
  });
});

describe("listenerTakes", () => {
  test("hands a listener only the types it asked for", () => {
    const adBreaks = listener(["channel.ad_break.begin"]);
    expect(listenerTakes(adBreaks, "channel.ad_break.begin")).toBe(true);
    expect(listenerTakes(adBreaks, "channel.follow")).toBe(false);
  });
});
