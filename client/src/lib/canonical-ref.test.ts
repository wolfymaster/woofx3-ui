import { describe, expect, test } from "bun:test";
import { canonicalRefFromProjectionKey } from "./canonical-ref";

describe("canonicalRefFromProjectionKey", () => {
  test("derives action canonical id from projection key", () => {
    expect(canonicalRefFromProjectionKey("twitch_platform:1.0.0:abc1234:action:twitch.chat.send", "action")).toBe(
      "twitch_platform:action:twitch.chat.send"
    );
  });

  test("derives trigger canonical id from projection key", () => {
    expect(canonicalRefFromProjectionKey("twitch_platform:1.0.0:abc1234:trigger:cheer.user.twitch", "trigger")).toBe(
      "twitch_platform:trigger:cheer.user.twitch"
    );
  });
});
