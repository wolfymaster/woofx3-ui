import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertLibraryGateway } from "@/engine/gateway";
import type { AlertComposition, InstanceId, NewLibraryAlert } from "@/engine/types";
import { fromInstanceId } from "./ids";
import { useMappedList, useMappedValue } from "./mapped";

function toAlertComposition({
  _id,
  _creationTime,
  instanceId,
  ...composition
}: Doc<"alertCompositions">): AlertComposition {
  return composition;
}

function useAlerts(instanceId: InstanceId | null) {
  const rows = useQuery(api.alertCompositions.list, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedList(rows, toAlertComposition);
}

function useAlert(instanceId: InstanceId, engineCompositionId: string) {
  const row = useQuery(api.alertCompositions.getByEngineId, {
    instanceId: fromInstanceId(instanceId),
    engineCompositionId,
  });
  return useMappedValue(row, toAlertComposition);
}

function useRefreshRequest() {
  const refresh = useAction(api.alertCompositionActions.refresh);
  return useCallback((instanceId: InstanceId) => refresh({ instanceId: fromInstanceId(instanceId) }), [refresh]);
}

function useCreateRequest() {
  const create = useAction(api.alertCompositionActions.create);
  return useCallback(
    (instanceId: InstanceId, alert: NewLibraryAlert) => create({ instanceId: fromInstanceId(instanceId), ...alert }),
    [create]
  );
}

function useRemoveRequest() {
  const remove = useAction(api.alertCompositionActions.remove);
  return useCallback(
    (instanceId: InstanceId, engineCompositionId: string) =>
      remove({ instanceId: fromInstanceId(instanceId), engineCompositionId }),
    [remove]
  );
}

function usePreviewUrlRequest() {
  const getUrl = useAction(api.compositionPreview.getUrl);
  return useCallback((instanceId: InstanceId) => getUrl({ instanceId: fromInstanceId(instanceId) }), [getUrl]);
}

export const convexAlertLibraryGateway: AlertLibraryGateway = {
  useAlerts,
  useAlert,
  useRefreshRequest,
  useCreateRequest,
  useRemoveRequest,
  usePreviewUrlRequest,
};
