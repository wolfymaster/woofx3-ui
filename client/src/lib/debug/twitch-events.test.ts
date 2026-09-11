import { describe, expect, test } from "bun:test";
import { EventType } from "@woofx3/cloudevents/Twitch/events";
import { TWITCH_EVENT_SUBJECTS } from "./twitch-events";

describe("TWITCH_EVENT_SUBJECTS", () => {
  // Compared against the engine's enum, not literals: a pin against a copy of
  // itself kept passing through two engine renames while the page fired
  // events nothing subscribed to.
  test("matches the engine's canonical CloudEvent types", () => {
    expect(TWITCH_EVENT_SUBJECTS).toEqual({
      follow: EventType.Follow,
      cheer: EventType.Cheer,
      subscribe: EventType.Subscribe,
      subscriptionGift: EventType.SubscriptionGift,
    });
  });
});
