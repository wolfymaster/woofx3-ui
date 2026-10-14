import { describe, expect, test } from "bun:test";
import type { StreamEventFrame } from "@woofx3/api";
import { EMPTY_TALLIES, STREAM_TALLY_EVENTS, tallyStreamEvent } from "./stream-tallies";

function frame(type: string, data: unknown, overrides: Partial<StreamEventFrame> = {}): StreamEventFrame {
  return {
    id: "evt-1",
    type,
    source: "twitch",
    time: "2026-09-15T12:00:00.000Z",
    platform: "twitch",
    data,
    ...overrides,
  };
}

describe("tallyStreamEvent", () => {
  test("counts follows, subs and raids as events", () => {
    let tallies = tallyStreamEvent(EMPTY_TALLIES, frame("channel.follow", { userName: "ana" }));
    tallies = tallyStreamEvent(tallies, frame("channel.subscribe", { userName: "ana", tier: "1000" }));
    tallies = tallyStreamEvent(tallies, frame("channel.raid", { fromBroadcasterUserName: "bob", viewers: 42 }));
    expect(tallies).toEqual({ follows: 1, subscribes: 1, giftedSubs: 0, bits: 0, raids: 1 });
  });

  test("sums the subs in a gift and the bits in a cheer, reading the engine's `amount`", () => {
    let tallies = tallyStreamEvent(EMPTY_TALLIES, frame("channel.subscriptionGift", { amount: 5, isAnonymous: true }));
    tallies = tallyStreamEvent(tallies, frame("channel.cheer", { amount: 500 }));
    tallies = tallyStreamEvent(tallies, frame("channel.cheer", { bits: 100 }));
    expect(tallies).toMatchObject({ giftedSubs: 5, bits: 500 });
  });

  test("ignores events it does not count, test events and malformed payloads", () => {
    expect(tallyStreamEvent(EMPTY_TALLIES, frame("stream.online", {}))).toBe(EMPTY_TALLIES);
    expect(tallyStreamEvent(EMPTY_TALLIES, frame("channel.follow", {}, { source: "api" }))).toBe(EMPTY_TALLIES);
    expect(tallyStreamEvent(EMPTY_TALLIES, frame("channel.cheer", undefined)).bits).toBe(0);
  });

  test("asks the engine for exactly the types it counts", () => {
    for (const type of STREAM_TALLY_EVENTS) {
      expect(tallyStreamEvent(EMPTY_TALLIES, frame(type, { amount: 1 }))).not.toEqual(EMPTY_TALLIES);
    }
  });
});
