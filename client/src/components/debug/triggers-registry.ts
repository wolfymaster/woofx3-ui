import type { ComponentType } from "react";
import { TwitchCheerForm } from "@/components/debug/twitch-cheer-form";
import { TwitchFollowForm } from "@/components/debug/twitch-follow-form";
import { TwitchSubscribeForm } from "@/components/debug/twitch-subscribe-form";
import { TwitchSubscriptionGiftForm } from "@/components/debug/twitch-subscription-gift-form";

export interface TriggerEntry {
  // Stable key for React lists. Use the canonical event subject.
  key: string;
  Form: ComponentType;
}

export interface TriggerGroup {
  // Display heading for the group (e.g. "Twitch").
  heading: string;
  // Stable key for React lists.
  key: string;
  entries: TriggerEntry[];
}

// Order is meaningful — these render in the listed sequence.
export const TRIGGER_GROUPS: TriggerGroup[] = [
  {
    heading: "Twitch",
    key: "twitch",
    entries: [
      { key: "follow.user.twitch", Form: TwitchFollowForm },
      { key: "subscribe.user.twitch", Form: TwitchSubscribeForm },
      { key: "subscription.gift.twitch", Form: TwitchSubscriptionGiftForm },
      { key: "cheer.user.twitch", Form: TwitchCheerForm },
    ],
  },
];
