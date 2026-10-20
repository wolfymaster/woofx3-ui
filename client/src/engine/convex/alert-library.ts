import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { AlertLibraryGateway } from "@/engine/gateway";
import type { InstanceId, NewLibraryAlert } from "@/engine/types";

function useAlerts(instanceId: InstanceId | null) {
  return useQuery(api.alertCompositions.list, instanceId ? { instanceId } : "skip");
}

function useAlert(instanceId: InstanceId, engineCompositionId: string) {
  return useQuery(api.alertCompositions.getByEngineId, { instanceId, engineCompositionId });
}

function useRefreshRequest() {
  const refresh = useAction(api.alertCompositionActions.refresh);
  return useCallback((instanceId: InstanceId) => refresh({ instanceId }), [refresh]);
}

function useCreateRequest() {
  const create = useAction(api.alertCompositionActions.create);
  return useCallback((instanceId: InstanceId, alert: NewLibraryAlert) => create({ instanceId, ...alert }), [create]);
}

function useRemoveRequest() {
  const remove = useAction(api.alertCompositionActions.remove);
  return useCallback(
    (instanceId: InstanceId, engineCompositionId: string) => remove({ instanceId, engineCompositionId }),
    [remove]
  );
}

function usePreviewUrlRequest() {
  const getUrl = useAction(api.compositionPreview.getUrl);
  return useCallback((instanceId: InstanceId) => getUrl({ instanceId }), [getUrl]);
}

export const convexAlertLibraryGateway: AlertLibraryGateway = {
  useAlerts,
  useAlert,
  useRefreshRequest,
  useCreateRequest,
  useRemoveRequest,
  usePreviewUrlRequest,
};
