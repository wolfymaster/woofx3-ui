import { useEngineGateway } from "@/engine/context";
import type { InstanceId } from "@/engine/types";

/** The engine's most recent alerts, newest first; a null id skips the read. */
export function useEngineAlerts(instanceId: InstanceId | null, limit: number) {
  return useEngineGateway().alertQueue.useAlerts(instanceId, limit);
}

/** Alert totals and hourly buckets for the window ending with `hourStart`'s hour; a null id skips the read. */
export function useAlertOverview(instanceId: InstanceId | null, hourStart: number) {
  return useEngineGateway().alertQueue.useOverview(instanceId, hourStart);
}

/** Ends the alert playing on every open overlay. */
export function useSkipCurrentAlertRequest() {
  return useEngineGateway().alertQueue.useSkipCurrentRequest();
}

/** Drops every alert still waiting in the overlay queue. */
export function useClearAlertQueueRequest() {
  return useEngineGateway().alertQueue.useClearQueueRequest();
}
