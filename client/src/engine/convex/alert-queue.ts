import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { EngineAlert, InstanceId } from "@/engine/types";
import { fromInstanceId } from "./ids";
import { useMappedList } from "./mapped";

function toEngineAlert({ _id, _creationTime, instanceId, ...alert }: Doc<"engineAlerts">): EngineAlert {
  return { id: _id, ...alert };
}

function useAlerts(instanceId: InstanceId | null, limit: number) {
  const rows = useQuery(
    api.engineAlerts.listForInstance,
    instanceId ? { instanceId: fromInstanceId(instanceId), limit } : "skip"
  );
  return useMappedList(rows, toEngineAlert);
}

function useOverview(instanceId: InstanceId | null, hourStart: number) {
  return useQuery(
    api.engineAlerts.overview,
    instanceId ? { instanceId: fromInstanceId(instanceId), hourStart } : "skip"
  );
}

function useReplayRequest() {
  const replay = useAction(api.alertActions.replay);
  return useCallback(
    (instanceId: InstanceId, engineAlertId: string) =>
      replay({ instanceId: fromInstanceId(instanceId), engineAlertId }),
    [replay]
  );
}

function useSkipCurrentRequest() {
  const skipCurrent = useAction(api.alertActions.skipCurrent);
  return useCallback(
    (instanceId: InstanceId) => skipCurrent({ instanceId: fromInstanceId(instanceId) }),
    [skipCurrent]
  );
}

function useClearQueueRequest() {
  const clearQueue = useAction(api.alertActions.clearQueue);
  return useCallback((instanceId: InstanceId) => clearQueue({ instanceId: fromInstanceId(instanceId) }), [clearQueue]);
}

export const convexAlertQueueGateway: AlertQueueGateway = {
  useAlerts,
  useOverview,
  useReplayRequest,
  useSkipCurrentRequest,
  useClearQueueRequest,
};
