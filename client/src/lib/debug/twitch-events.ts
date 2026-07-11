// Canonical Twitch CloudEvent type strings + payload shapes.
//
// Mirrored from the engine source of truth at
//   ~/code/wolfymaster/woofx3/shared/common/typescript/cloudevents/Twitch/events.ts
// (the engine's `EventType` enum + per-event interfaces). Kept in sync by the
// pin test in twitch-events.test.ts. If any of these strings change in the
// engine, that test fails — update both sides together.
//
// We mirror rather than import because @woofx3/api does not re-export the
// cloudevents subpath today; pulling that subpath into the vite alias is a
// larger surface change than this debug page warrants.

export const TWITCH_EVENT_SUBJECTS = {
  follow: "follow.user.twitch",
  cheer: "cheer.user.twitch",
  subscribe: "subscribe.user.twitch",
  subscriptionGift: "subscription.gift.twitch",
} as const;

export type TwitchEventKey = keyof typeof TWITCH_EVENT_SUBJECTS;

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
