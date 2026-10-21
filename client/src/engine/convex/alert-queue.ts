import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { EngineAlert } from "@/engine/types";
import { useMappedList } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

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

function useAlerts(limit: number) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.engineAlerts.listForInstance, instanceId ? { instanceId, limit } : "skip");
  return useMappedList(rows, toEngineAlert);
}

function useOverview(hourStart: number) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.engineAlerts.overview, instanceId ? { instanceId, hourStart } : "skip");
}

function useReplayRequest() {
  const replay = useInstanceAction(api.alertActions.replay);
  return useCallback((engineAlertId: string) => replay({ engineAlertId }), [replay]);
}

function useSkipCurrentRequest() {
  const skipCurrent = useInstanceAction(api.alertActions.skipCurrent);
  return useCallback(() => skipCurrent({}), [skipCurrent]);
}

function useClearQueueRequest() {
  const clearQueue = useInstanceAction(api.alertActions.clearQueue);
  return useCallback(() => clearQueue({}), [clearQueue]);
}

export const convexAlertQueueGateway: AlertQueueGateway = {
  useAlerts,
  useOverview,
  useReplayRequest,
  useSkipCurrentRequest,
  useClearQueueRequest,
};
