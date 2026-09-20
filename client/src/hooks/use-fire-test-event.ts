import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import type { TriggerPreset } from "@/lib/workflow-presets";

const TWITCH_PLATFORM_AXIS = "platform.twitch";

/**
 * Returns a callback that fires a test event for a trigger at the currently
 * selected woofx3 instance. Used by the test-event sheet on the Alerts screen.
 *
 * Resolves to the correlation key it minted, or null when nothing was
 * published. The key is generated here, before the call, so the caller can
 * subscribe to the outcome before the run exists — and so a lost response
 * cannot strand an event whose result nobody can find.
 *
 * Only failures of the call itself are toasted. What the event went on to
 * cause is decided afterwards in another process and reaches the caller
 * through that key, so a toast cannot report it and deliberately does not try.
 *
 * Twitch triggers go through `simulateTwitchEvent`, which stamps
 * `platform: "twitch"` so the event is identical to a real one and passes
 * `${trigger.platform}` filters. Anything else is published as-is — there is no
 * simulator for other platforms.
 */
export function useFireTestEvent() {
  const { instance } = useInstance();
  const simulateTwitchEvent = useAction(api.debug.simulateTwitchEvent);
  const publishEvent = useAction(api.debug.fireTrigger);
  const { toast } = useToast();

  return async function fireTestEvent(preset: TriggerPreset, eventData: object): Promise<string | null> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before firing test events.",
      });
      return null;
    }
    const eventType = preset.event;
    if (!eventType) {
      toast({
        variant: "destructive",
        title: "Nothing to fire",
        description: `${preset.name} does not declare an event.`,
      });
      return null;
    }
    const fire = preset.taxonomy?.includes(TWITCH_PLATFORM_AXIS) ? simulateTwitchEvent : publishEvent;
    const triggerId = crypto.randomUUID();
    try {
      await fire({ instanceId: instance._id, eventType, eventData, triggerId, triggeredBy: "dashboard" });
      return triggerId;
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to fire event",
        description: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
}
