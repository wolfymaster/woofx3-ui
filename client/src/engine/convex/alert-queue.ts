import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useState } from "react";
import type { AlertQueueGateway } from "@/engine/gateway";
import type { EngineAlert, OverlayPresence, ReadOptions } from "@/engine/types";
import { OVERLAY_PRESENCE_POLL_MS, overlayPresenceOf } from "@/lib/overlay-presence";
import { useMappedList } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

type AlertListRow = FunctionReturnType<typeof api.engineAlerts.listForInstance>[number];

function toEngineAlert(row: AlertListRow): EngineAlert {
  return {
    id: row._id,
    engineAlertId: row.engineAlertId,
    status: row.status,
    payload: row.payload,
    workflowId: row.workflowId,
    sourceEventId: row.sourceEventId,
    error: row.error,
    engineCreatedAt: row.engineCreatedAt,
    createdAt: row.createdAt,
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

/** Each read waits for the last to answer, so a slow engine is never asked twice at once. */
function useOverlayOpen({ enabled = true }: ReadOptions = {}) {
  const readQueue = useInstanceAction(api.alertActions.queueState);
  const [presence, setPresence] = useState<OverlayPresence | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      // A failed read says nothing about the overlay, so it is not an error here.
      const next = await readQueue({}).then(overlayPresenceOf, (): OverlayPresence => "unknown");
      if (!stopped) {
        setPresence(next);
        timer = setTimeout(() => void poll(), OVERLAY_PRESENCE_POLL_MS);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, readQueue]);
  return enabled ? presence : undefined;
}

export const convexAlertQueueGateway: AlertQueueGateway = {
  useAlerts,
  useOverview,
  useReplayRequest,
  useSkipCurrentRequest,
  useClearQueueRequest,
  useOverlayOpen,
};
