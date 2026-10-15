import { describe, expect, test } from "bun:test";
import { listenerTakes, type StreamListener, streamTypesUnion } from "./stream-listeners";

function listener(types: string[] | null): StreamListener {
  return { types: types ? new Set(types) : null, callback: () => {} };
}

describe("streamTypesUnion", () => {
  test("unions every listener's types, unique and sorted", () => {
    const union = streamTypesUnion([
      listener(["channel.follow", "channel.cheer"]),
      listener(["channel.ad_break.begin", "channel.follow"]),
    ]);
    expect(union).toEqual(["channel.ad_break.begin", "channel.cheer", "channel.follow"]);
  });

  test("adds nothing for a listener that takes whatever arrives", () => {
    expect(streamTypesUnion([listener(null), listener(["channel.raid"])])).toEqual(["channel.raid"]);
    expect(streamTypesUnion([listener(null)])).toEqual([]);
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

  test("hands a listener without types every frame", () => {
    expect(listenerTakes(listener(null), "channel.follow")).toBe(true);
  });
});
