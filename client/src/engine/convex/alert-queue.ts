import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { EngineAlert, InstanceId } from "@/engine/types";
import { fromInstanceId } from "./ids";
import { useMappedList } from "./mapped";

function toEngineAlert(row: Doc<"engineAlerts">): EngineAlert {
  return {
    id: row._id,
    engineAlertId: row.engineAlertId,
    status: row.status,
    payload: row.payload,
    workflowId: row.workflowId,
    sourceEventId: row.sourceEventId,
    engineStatus: row.engineStatus,
    envelopeId: row.envelopeId,
    dispatchedAt: row.dispatchedAt,
    playedAt: row.playedAt,
    completedAt: row.completedAt,
    error: row.error,
    engineCreatedAt: row.engineCreatedAt,
    engineUpdatedAt: row.engineUpdatedAt,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt,
    progressedAt: row.progressedAt,
    unconfirmedAt: row.unconfirmedAt,
  };
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
