import { describe, expect, test } from "bun:test";
import { readPushedFrame } from "./streamEvents";

describe("readPushedFrame", () => {
  test("keeps a whole frame", () => {
    const frame = {
      id: "e1",
      type: "channel.follow",
      source: "twitch",
      time: "2026-11-24T00:00:00Z",
      platform: "twitch",
      data: { userName: "viewer" },
    };
    expect(readPushedFrame(frame)).toEqual(frame);
  });

  test("defaults the source and leaves out an id and platform it was not given", () => {
    expect(readPushedFrame({ type: "goal.reached", time: "2026-11-24T00:00:00Z", data: 1 })).toEqual({
      type: "goal.reached",
      source: "engine",
      time: "2026-11-24T00:00:00Z",
      data: 1,
    });
  });

  for (const [name, value] of [
    ["not an object", "frame"],
    ["null", null],
    ["no type", { time: "2026-11-24T00:00:00Z" }],
    ["an empty type", { type: "", time: "2026-11-24T00:00:00Z" }],
    ["no time", { type: "channel.follow" }],
  ] as const) {
    test(`refuses ${name}`, () => {
      expect(readPushedFrame(value)).toBeNull();
    });
  }
});
