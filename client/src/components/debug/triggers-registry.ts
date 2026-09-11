import type { ComponentType } from "react";
import { TwitchCheerForm } from "@/components/debug/twitch-cheer-form";
import { TwitchFollowForm } from "@/components/debug/twitch-follow-form";
import { TwitchSubscribeForm } from "@/components/debug/twitch-subscribe-form";
import { TwitchSubscriptionGiftForm } from "@/components/debug/twitch-subscription-gift-form";
import { TWITCH_EVENT_SUBJECTS } from "@/lib/debug/twitch-events";

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
      { key: TWITCH_EVENT_SUBJECTS.follow, Form: TwitchFollowForm },
      { key: TWITCH_EVENT_SUBJECTS.subscribe, Form: TwitchSubscribeForm },
      { key: TWITCH_EVENT_SUBJECTS.subscriptionGift, Form: TwitchSubscriptionGiftForm },
      { key: TWITCH_EVENT_SUBJECTS.cheer, Form: TwitchCheerForm },
    ],
  },
];
