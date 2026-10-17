import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { InstanceId } from "@/engine/types";

function useAlerts(instanceId: InstanceId | null, limit: number) {
  return useQuery(api.engineAlerts.listForInstance, instanceId ? { instanceId, limit } : "skip");
}

function useOverview(instanceId: InstanceId | null, hourStart: number) {
  return useQuery(api.engineAlerts.overview, instanceId ? { instanceId, hourStart } : "skip");
}

function useReplayRequest() {
  const replay = useAction(api.alertActions.replay);
  return useCallback(
    (instanceId: InstanceId, engineAlertId: string) => replay({ instanceId, engineAlertId }),
    [replay]
  );
}

function useSkipCurrentRequest() {
  const skipCurrent = useAction(api.alertActions.skipCurrent);
  return useCallback((instanceId: InstanceId) => skipCurrent({ instanceId }), [skipCurrent]);
}

function useClearQueueRequest() {
  const clearQueue = useAction(api.alertActions.clearQueue);
  return useCallback((instanceId: InstanceId) => clearQueue({ instanceId }), [clearQueue]);
}

export const convexAlertQueueGateway: AlertQueueGateway = {
  useAlerts,
  useOverview,
  useReplayRequest,
  useSkipCurrentRequest,
  useClearQueueRequest,
};
