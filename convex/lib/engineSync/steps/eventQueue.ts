import { isEventQueueConfigured, moveInstanceToEventQueue } from "../../../engineEventQueue";
import { eventQueueUrlsFromEnv } from "../../engineEvents/move";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * eventQueueStep: moves the engine onto the event queue once it advertises
 * `callbacks.eventsTarget`, which an engine upgraded in place starts doing at
 * its next start. A deployment with no queue configured (a pull request
 * preview, say) keeps every engine on the webhook route, so the step does
 * nothing there.
 */
export const eventQueueStep: SyncStep = {
  name: "eventQueue",
  run: async ({ ctx, instanceId }: SyncStepContext) => {
    if (!isEventQueueConfigured()) {
      return { itemsProcessed: 0 };
    }
    const outcome = await moveInstanceToEventQueue(ctx, instanceId, eventQueueUrlsFromEnv());
    return { itemsProcessed: outcome === "moved" ? 1 : 0 };
  },
};
