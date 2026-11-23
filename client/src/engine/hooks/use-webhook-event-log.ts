import { useEngineGateway, useEngineScope } from "@/engine/context";
import type { WebhookEventId } from "@/engine/types";
import { useToast } from "@/hooks/use-toast";
import { useLogger } from "@/lib/logger-context";

/**
 * Returns a callback that re-fires a logged engineEventLog row's
 * (eventType, payload) at the currently selected woofx3 instance. Mirrors
 * use-fire-trigger.ts's UX contract (toast on success/failure).
 */
export function useRetriggerEvent() {
  const logger = useLogger();
  const { instanceId } = useEngineScope();
  const retrigger = useEngineGateway().eventLog.useRetriggerRequest();
  const { toast } = useToast();

  return async function retriggerEvent(logId: WebhookEventId, eventType: string): Promise<void> {
    if (!instanceId) {
      toast({
        variant: "destructive",
        title: "No engine selected",
        description: "Pick an engine with Switch engine in your profile menu before retriggering events.",
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
      logger.error("Could not retrigger event", { error: err, logId });
      toast({
        variant: "destructive",
        title: "Couldn't resend the event",
        description: "Try again.",
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
