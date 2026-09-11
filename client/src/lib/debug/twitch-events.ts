// Canonical Twitch CloudEvent type strings + payload shapes.
//
// Mirrored from the engine source of truth at
//   ~/code/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts
// (the engine's `EventType` enum + per-event interfaces). Event types are
// platform-agnostic; the engine stamps `platform: "twitch"` when they are
// fired through `simulateTwitchEvent`. The pin test in twitch-events.test.ts
// compares against the engine enum itself, so a rename there fails it —
// update both sides together.
//
// We mirror rather than import because @woofx3/api does not re-export the
// cloudevents subpath today; the `@woofx3/cloudevents` alias the test uses is
// not wired into Vite, which is a larger surface change than this debug page
// warrants.

export const TWITCH_EVENT_SUBJECTS = {
  follow: "channel.follow",
  cheer: "channel.cheer",
  subscribe: "channel.subscribe",
  subscriptionGift: "channel.subscriptionGift",
} as const;

export type TwitchEventKey = keyof typeof TWITCH_EVENT_SUBJECTS;

export type TwitchEventSubject = (typeof TWITCH_EVENT_SUBJECTS)[TwitchEventKey];

export interface TwitchFollowPayload {
  userName: string;
}

export interface TwitchCheerPayload {
  amount: number;
  isAnonymous: boolean;
  message: string;
  userId: string | null;
  userName: string | null;
}

export interface TwitchSubscribePayload {
  isGift: boolean;
  tier: string;
  userId: string | null;
  userName: string | null;
}

export interface TwitchSubscriptionGiftPayload {
  amount: number;
  gifterId: string;
  gifterName: string;
  isAnonymous: boolean;
  tier: string;
}
