import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { OptimisticInstance, StatusGateway } from "@/engine/gateway";
import type { InstanceId } from "@/engine/types";
import { useOptimisticInstanceQueryFor } from "@/hooks/use-optimistic-instance-query";

// Each request hook wraps a `useAction`, which Convex memoises on the
// function's name, so the returned function keeps its identity across renders
// and is safe in effect dependencies.

function useCapabilitiesRequest() {
  const get = useAction(api.engineCapabilities.get);
  return useCallback((instanceId: InstanceId) => get({ instanceId }), [get]);
}

function useEngineInfoRequest() {
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  return useCallback((instanceId: InstanceId) => getEngineInfo({ instanceId }), [getEngineInfo]);
}

function useSetOverlayPublicUrlRequest() {
  const setOverlayPublicUrl = useAction(api.engineInfo.setOverlayPublicUrl);
  return useCallback(
    (instanceId: InstanceId, value: string) => setOverlayPublicUrl({ instanceId, value }),
    [setOverlayPublicUrl]
  );
}

function useConnectionTestRequest() {
  const testConnection = useAction(api.engineHealth.testConnection);
  return useCallback((url: string) => testConnection({ url }), [testConnection]);
}

function useObsStatusRequest() {
  const get = useAction(api.obsStatus.get);
  return useCallback((instanceId: InstanceId) => get({ instanceId }), [get]);
}

function useLiveState({ optimisticInstanceId, isInstanceLoading }: OptimisticInstance) {
  return useOptimisticInstanceQueryFor(api.instanceLiveState.getForInstance, optimisticInstanceId, isInstanceLoading);
}

function useLiveStatePollRequest() {
  const pollLiveState = useAction(api.streamStatus.pollLiveState);
  return useCallback((instanceId: InstanceId) => pollLiveState({ instanceId }), [pollLiveState]);
}

function useSyncState(instanceId: InstanceId | null) {
  return useQuery(api.engineSync.getSyncState, instanceId ? { instanceId } : "skip");
}

function useSyncRequest() {
  const syncNow = useAction(api.engineSync.syncNow);
  return useCallback((instanceId: InstanceId) => syncNow({ instanceId }), [syncNow]);
}

export const convexStatusGateway: StatusGateway = {
  useCapabilitiesRequest,
  useEngineInfoRequest,
  useSetOverlayPublicUrlRequest,
  useConnectionTestRequest,
  useObsStatusRequest,
  useLiveState,
  useLiveStatePollRequest,
  useSyncState,
  useSyncRequest,
};
