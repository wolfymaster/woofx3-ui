import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { WebhookEventId } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";

/**
 * Returns a callback that re-fires a logged engineEventLog row's
 * (eventType, payload) at the currently selected woofx3 instance. Mirrors
 * use-fire-trigger.ts's UX contract (toast on success/failure).
 */
export function useRetriggerEvent() {
  const { instanceId } = useEngineScope();
  const retrigger = useEngineGateway().eventLog.useRetriggerRequest();
  const { toast } = useToast();

  return async function retriggerEvent(logId: WebhookEventId, eventType: string): Promise<void> {
    if (!instanceId) {
      toast({
        variant: "destructive",
        title: "No instance selected",
        description: "Pick an instance from the workspace switcher before retriggering events.",
      });
      return;
    }
    try {
      const result = await retrigger(logId);
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

/** The webhook log, newest first, optionally of one type. */
export function useWebhookEventLog(eventType: string | null, initialNumItems: number) {
  return useEngineGateway().eventLog.useWebhookEvents(eventType, initialNumItems);
}

/** One logged event's raw payload JSON; null when it is gone. */
export function useWebhookEventPayload(logId: WebhookEventId) {
  return useEngineGateway().eventLog.useWebhookPayload(logId);
}
