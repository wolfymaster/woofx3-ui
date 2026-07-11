import { describe, expect, test } from "bun:test";
import { TWITCH_EVENT_SUBJECTS } from "./twitch-events";

describe("TWITCH_EVENT_SUBJECTS", () => {
  test("matches the canonical CloudEvent type strings used by the engine", () => {
    expect(TWITCH_EVENT_SUBJECTS).toEqual({
      follow: "follow.user.twitch",
      cheer: "cheer.user.twitch",
      subscribe: "subscribe.user.twitch",
      subscriptionGift: "subscription.gift.twitch",
    });
  });
});
