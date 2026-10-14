import type { StreamEventFrame } from "@woofx3/api";
import { TEST_EVENT_SOURCE } from "@/lib/activity-feed";

/** What has come in since the page loaded, as the Stream Stats widget counts it. */
export interface StreamTallies {
  follows: number;
  subscribes: number;
  giftedSubs: number;
  bits: number;
  raids: number;
}

export const EMPTY_TALLIES: StreamTallies = { follows: 0, subscribes: 0, giftedSubs: 0, bits: 0, raids: 0 };

/** The event types `tallyStreamEvent` counts, which the widget asks the engine to push. */
export const STREAM_TALLY_EVENTS: readonly string[] = [
  "channel.follow",
  "channel.subscribe",
  "channel.subscriptionGift",
  "channel.cheer",
  "channel.raid",
];

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The tallies with one pushed event counted, or `tallies` itself when the
 * event is not one they count.
 *
 * These are Twitch's own totals, so the event types and fields are Twitch's,
 * as the engine's twitch service publishes them (camelCase, not EventSub's raw
 * `bits` / `user_name`). A test event the dashboard fired is not counted.
 */
export function tallyStreamEvent(tallies: StreamTallies, frame: StreamEventFrame): StreamTallies {
  if (frame.source === TEST_EVENT_SOURCE) {
    return tallies;
  }
  const data = frame.data && typeof frame.data === "object" ? (frame.data as Record<string, unknown>) : {};
  switch (frame.type) {
    case "channel.follow":
      return { ...tallies, follows: tallies.follows + 1 };
    case "channel.subscribe":
      return { ...tallies, subscribes: tallies.subscribes + 1 };
    case "channel.subscriptionGift":
      // One gift event can carry many subs, so this sums `amount` rather than
      // counting events. It stays apart from Subs because Twitch also sends a
      // channel.subscribe (isGift) per recipient, which Subs already counts.
      return { ...tallies, giftedSubs: tallies.giftedSubs + count(data.amount) };
    case "channel.cheer":
      return { ...tallies, bits: tallies.bits + count(data.amount) };
    case "channel.raid":
      return { ...tallies, raids: tallies.raids + 1 };
    default:
      return tallies;
  }
}
