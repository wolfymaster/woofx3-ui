import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import type { TwitchEventSubject } from "@/lib/debug/twitch-events";

/**
 * Returns a callback that injects a synthetic Twitch event at the currently
 * selected woofx3 instance. Surfaces the engine's response (or any error) as a
 * toast. Used by the /debug page trigger forms.
 */
export function useSimulateTwitchEvent() {
  const { instance } = useInstance();
  const simulate = useAction(api.debug.simulateTwitchEvent);
  const { toast } = useToast();

  return async function simulateTwitchEvent(
    eventType: TwitchEventSubject,
    eventData: Record<string, unknown>
  ): Promise<void> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before firing test events.",
      });
      return;
    }
    try {
      const result = await simulate({ instanceId: instance._id, eventType, eventData });
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
