import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertLibraryGateway } from "@/engine/gateway";
import type { AlertComposition, NewLibraryAlert, ReadOptions } from "@/engine/types";
import { useMappedList, useMappedValue } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

function toAlertComposition(row: Doc<"alertCompositions">): AlertComposition {
  return {
    engineCompositionId: row.engineCompositionId,
    name: row.name,
    description: row.description,
    widgets: row.widgets,
    layout: row.layout,
    behaviors: row.behaviors,
    inputs: row.inputs,
    createdByType: row.createdByType,
    createdByRef: row.createdByRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function useAlerts({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const rows = useQuery(api.alertCompositions.list, enabled && instanceId ? { instanceId } : "skip");
  return useMappedList(rows, toAlertComposition);
}

function useAlert(engineCompositionId: string) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.alertCompositions.getByEngineId, instanceId ? { instanceId, engineCompositionId } : "skip");
  return useMappedValue(row, toAlertComposition);
}

function useRefreshRequest() {
  const refresh = useInstanceAction(api.alertCompositionActions.refresh);
  return useCallback(() => refresh({}), [refresh]);
}

function useCreateRequest() {
  const create = useInstanceAction(api.alertCompositionActions.create);
  return useCallback((alert: NewLibraryAlert) => create(alert), [create]);
}

function useRemoveRequest() {
  const remove = useInstanceAction(api.alertCompositionActions.remove);
  return useCallback((engineCompositionId: string) => remove({ engineCompositionId }), [remove]);
}

function usePreviewUrlRequest() {
  const getUrl = useInstanceAction(api.compositionPreview.getUrl);
  return useCallback(() => getUrl({}), [getUrl]);
}

export const convexAlertLibraryGateway: AlertLibraryGateway = {
  useAlerts,
  useAlert,
  useRefreshRequest,
  useCreateRequest,
  useRemoveRequest,
  usePreviewUrlRequest,
};
