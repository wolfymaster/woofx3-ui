import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

/**
 * Returns a callback that fires a synthetic event at the currently selected
 * woofx3 instance. Surfaces the engine's response (or any error) as a toast.
 * Used by the /debug page trigger forms.
 */
export function useFireTrigger() {
  const { instance } = useInstance();
  const fire = useAction(api.debug.fireTrigger);
  const { toast } = useToast();

  return async function fireTrigger(eventType: string, eventData: Record<string, unknown>): Promise<void> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before firing test events.",
      });
      return;
    }
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
