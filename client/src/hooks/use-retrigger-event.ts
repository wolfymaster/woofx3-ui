import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";

/**
 * Returns a callback that re-fires a logged engineEventLog row's
 * (eventType, payload) at the currently selected woofx3 instance. Mirrors
 * use-fire-trigger.ts's UX contract (toast on success/failure).
 */
export function useRetriggerEvent() {
  const { instance } = useInstance();
  const retrigger = useAction(api.engineEventLog.retrigger);
  const { toast } = useToast();

  return async function retriggerEvent(logId: Id<"engineEventLog">, eventType: string): Promise<void> {
    if (!instance) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before retriggering events.",
      });
      return;
    }
    try {
      const result = await retrigger({ instanceId: instance._id, logId });
      toast({
        title: "Event retriggered",
        description: `${eventType} → ${result.message}`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to retrigger event",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
