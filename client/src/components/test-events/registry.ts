import type { ComponentType } from "react";
import { JsonTestEventForm } from "@/components/test-events/json-test-event-form";
import type { TestEventProps } from "@/components/test-events/test-event-form";
import { TwitchCheerForm } from "@/components/test-events/twitch-cheer-form";
import { TwitchFollowForm } from "@/components/test-events/twitch-follow-form";
import { TwitchSubscribeForm } from "@/components/test-events/twitch-subscribe-form";
import { TwitchSubscriptionGiftForm } from "@/components/test-events/twitch-subscription-gift-form";
import { TWITCH_EVENT_SUBJECTS } from "@/lib/debug/twitch-events";
import type { TriggerPreset } from "@/lib/workflow-presets";

/**
 * Hand-built forms for events whose payload the UI knows field by field. Keyed by
 * event rather than trigger, since the payload belongs to the event.
 */
const FORMS_BY_EVENT = new Map<string, ComponentType<TestEventProps>>([
  [TWITCH_EVENT_SUBJECTS.follow, TwitchFollowForm],
  [TWITCH_EVENT_SUBJECTS.subscribe, TwitchSubscribeForm],
  [TWITCH_EVENT_SUBJECTS.subscriptionGift, TwitchSubscriptionGiftForm],
  [TWITCH_EVENT_SUBJECTS.cheer, TwitchCheerForm],
]);

/** The form for testing `preset` — its hand-built one, or the JSON editor for everything else. */
export function testEventFormFor(preset: TriggerPreset): ComponentType<TestEventProps> {
  const form = preset.event ? FORMS_BY_EVENT.get(preset.event) : undefined;
  return form ?? JsonTestEventForm;
}
