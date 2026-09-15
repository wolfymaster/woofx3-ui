import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import type { TriggerPreset } from "@/lib/workflow-presets";

const TWITCH_PLATFORM_AXIS = "platform.twitch";

/**
 * Returns a callback that fires a test event for a trigger at the currently
 * selected woofx3 instance, and reports the engine's response (or any error) as a
 * toast. Used by the test-event sheet on the Alerts screen.
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

  return async function fireTestEvent(preset: TriggerPreset, eventData: object): Promise<void> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before firing test events.",
      });
      return;
    }
    const eventType = preset.event;
    if (!eventType) {
      toast({
        variant: "destructive",
        title: "Nothing to fire",
        description: `${preset.name} does not declare an event.`,
      });
      return;
    }
    const fire = preset.taxonomy?.includes(TWITCH_PLATFORM_AXIS) ? simulateTwitchEvent : publishEvent;
    try {
      const result = await fire({ instanceId: instance._id, eventType, eventData });
      toast({
        title: "Event fired",
        description: `${eventType} → ${result.message}`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to fire event",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
