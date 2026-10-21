import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useCallback } from "react";
import type { OptimisticInstance, StatusGateway } from "@/engine/gateway";
import type { EngineSyncRun, EngineSyncSchedule, EngineSyncState, InstanceId, InstanceLiveState } from "@/engine/types";
import { useOptimisticInstanceQueryFor } from "@/hooks/use-optimistic-instance-query";
import { fromInstanceId } from "./ids";
import { useMappedValue } from "./mapped";

// Each request hook wraps a `useAction`, which Convex memoises on the
// function's name, so the returned function keeps its identity across renders
// and is safe in effect dependencies.

/**
 * A refusal Convex raised for the caller carries its text in `data`; it is
 * rethrown as a plain Error so callers read one error shape whichever gateway
 * answered.
 */
function withPlainError(error: unknown): never {
  if (error instanceof ConvexError && typeof error.data === "string") {
    throw new Error(error.data);
  }
  throw error;
}

function useCapabilitiesRequest() {
  const get = useAction(api.engineCapabilities.get);
  return useCallback(
    (instanceId: InstanceId) => get({ instanceId: fromInstanceId(instanceId) }).catch(withPlainError),
    [get]
  );
}

function useEngineInfoRequest() {
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  return useCallback(
    (instanceId: InstanceId) => getEngineInfo({ instanceId: fromInstanceId(instanceId) }),
    [getEngineInfo]
  );
}

function useSetOverlayPublicUrlRequest() {
  const setOverlayPublicUrl = useAction(api.engineInfo.setOverlayPublicUrl);
  return useCallback(
    (instanceId: InstanceId, value: string) => setOverlayPublicUrl({ instanceId: fromInstanceId(instanceId), value }),
    [setOverlayPublicUrl]
  );
}

function useConnectionTestRequest() {
  const testConnection = useAction(api.engineHealth.testConnection);
  return useCallback((url: string) => testConnection({ url }), [testConnection]);
}

function useObsStatusRequest() {
  const get = useAction(api.obsStatus.get);
  return useCallback((instanceId: InstanceId) => get({ instanceId: fromInstanceId(instanceId) }), [get]);
}

function toInstanceLiveState(row: Doc<"instanceLiveState">): InstanceLiveState {
  return {
    isLive: row.isLive,
    twitchUserId: row.twitchUserId,
    startedAt: row.startedAt,
    sessionId: row.sessionId,
    sessionStartedAt: row.sessionStartedAt,
    streamTitle: row.streamTitle,
    gameName: row.gameName,
    viewerCount: row.viewerCount,
    lastUpdateSource: row.lastUpdateSource,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}

function useLiveState({ optimisticInstanceId, isInstanceLoading }: OptimisticInstance) {
  const row = useOptimisticInstanceQueryFor(
    api.instanceLiveState.getForInstance,
    optimisticInstanceId ? fromInstanceId(optimisticInstanceId) : null,
    isInstanceLoading
  );
  return useMappedValue(row, toInstanceLiveState);
}

function useLiveStatePollRequest() {
  const pollLiveState = useAction(api.streamStatus.pollLiveState);
  return useCallback(
    (instanceId: InstanceId) => pollLiveState({ instanceId: fromInstanceId(instanceId) }),
    [pollLiveState]
  );
}

function toEngineSyncSchedule(row: Doc<"instanceSync">): EngineSyncSchedule {
  return {
    status: row.status,
    nextEligibleAt: row.nextEligibleAt,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    lastDurationMs: row.lastDurationMs,
    consecutiveErrorCount: row.consecutiveErrorCount,
    syncIntervalMs: row.syncIntervalMs,
  };
}

function toEngineSyncStep(step: Doc<"syncRuns">["steps"][number]): EngineSyncRun["steps"][number] {
  return {
    name: step.name,
    status: step.status,
    itemsProcessed: step.itemsProcessed,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    error: step.error,
  };
}

function toEngineSyncRun(row: Doc<"syncRuns">): EngineSyncRun {
  return {
    id: row._id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
    steps: row.steps.map(toEngineSyncStep),
  };
}

function toEngineSyncState(
  state: NonNullable<FunctionReturnType<typeof api.engineSync.getSyncState>>
): EngineSyncState {
  return {
    syncState: state.syncState ? toEngineSyncSchedule(state.syncState) : null,
    currentRun: state.currentRun ? toEngineSyncRun(state.currentRun) : null,
    recentRuns: state.recentRuns.map(toEngineSyncRun),
  };
}

function useSyncState(instanceId: InstanceId | null) {
  const state = useQuery(api.engineSync.getSyncState, instanceId ? { instanceId: fromInstanceId(instanceId) } : "skip");
  return useMappedValue(state, toEngineSyncState);
}

function useSyncRequest() {
  const syncNow = useAction(api.engineSync.syncNow);
  return useCallback((instanceId: InstanceId) => syncNow({ instanceId: fromInstanceId(instanceId) }), [syncNow]);
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
