import { describe, expect, test } from "bun:test";
import type { StreamEventFrame } from "@woofx3/api";
import { frameToPlatformEvent } from "./engine-events";

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

describe("frameToPlatformEvent", () => {
  test("maps a follow", () => {
    const event = frameToPlatformEvent(frame("channel.follow", { userName: "ana" }));
    expect(event).toMatchObject({ type: "follow", userName: "ana", platform: "twitch", id: "evt-1" });
  });

  test("maps a subscribe with its tier", () => {
    const event = frameToPlatformEvent(frame("channel.subscribe", { userName: "ana", tier: "2000" }));
    expect(event).toMatchObject({ type: "subscribe", userName: "ana", tier: "2000" });
  });

  test("maps a cheer, reading the engine's `amount` rather than Twitch's `bits`", () => {
    const event = frameToPlatformEvent(
      frame("channel.cheer", { userName: "ana", amount: 500, message: "gg", isAnonymous: false })
    );
    expect(event).toMatchObject({ type: "cheer", userName: "ana", amount: 500, message: "gg" });
  });

  test("names an anonymous cheerer rather than showing a missing user", () => {
    const event = frameToPlatformEvent(frame("channel.cheer", { userName: null, amount: 100, isAnonymous: true }));
    expect(event).toMatchObject({ userName: "Anonymous", amount: 100 });
  });

  test("maps a raid from the broadcaster fields, with viewers as the amount", () => {
    const event = frameToPlatformEvent(
      frame("channel.raid", { fromBroadcasterUserName: "bob", fromBroadcasterUserId: "7", viewers: 42 })
    );
    expect(event).toMatchObject({ type: "raid", userName: "bob", amount: 42 });
  });

  test("ignores Twitch's raw snake_case wire fields, which the engine does not emit", () => {
    const event = frameToPlatformEvent(frame("channel.cheer", { user_name: "ana", bits: 500 }));
    expect(event).toMatchObject({ userName: "Unknown" });
    expect(event?.amount).toBeUndefined();
  });

  test("drops events the widgets do not render", () => {
    expect(frameToPlatformEvent(frame("channel.subscriptionGift", { gifterName: "ana" }))).toBeNull();
    expect(frameToPlatformEvent(frame("stream.online", { broadcasterUserName: "ana" }))).toBeNull();
    expect(frameToPlatformEvent(frame("user.message", { message: "hi" }))).toBeNull();
  });

  test("carries the CloudEvent time through", () => {
    const event = frameToPlatformEvent(frame("channel.follow", { userName: "ana" }));
    expect(event?.timestamp.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  test("falls back to now rather than an Invalid Date", () => {
    const event = frameToPlatformEvent(frame("channel.follow", { userName: "ana" }, { time: "not-a-time" }));
    expect(Number.isNaN(event?.timestamp.getTime())).toBe(false);
  });

  test("generates an id when the publisher set none", () => {
    const event = frameToPlatformEvent(frame("channel.follow", { userName: "ana" }, { id: undefined }));
    expect(event?.id).toBeTruthy();
  });

  test("survives a missing or non-object payload", () => {
    expect(frameToPlatformEvent(frame("channel.follow", undefined))).toMatchObject({ userName: "Unknown" });
    expect(frameToPlatformEvent(frame("channel.follow", {}))).toMatchObject({ userName: "Unknown" });
  });
});
