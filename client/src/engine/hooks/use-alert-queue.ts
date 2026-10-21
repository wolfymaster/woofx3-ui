import { useEngineGateway } from "@/engine/context";

/** The engine's most recent alerts, newest first. */
export function useEngineAlerts(limit: number) {
  return useEngineGateway().alertQueue.useAlerts(limit);
}

/** Alert totals and hourly buckets for the window ending with `hourStart`'s hour. */
export function useAlertOverview(hourStart: number) {
  return useEngineGateway().alertQueue.useOverview(hourStart);
}

/** Ends the alert playing on every open overlay. */
export function useSkipCurrentAlertRequest() {
  return useEngineGateway().alertQueue.useSkipCurrentRequest();
}

/** Drops every alert still waiting in the overlay queue. */
export function useClearAlertQueueRequest() {
  return useEngineGateway().alertQueue.useClearQueueRequest();
}
