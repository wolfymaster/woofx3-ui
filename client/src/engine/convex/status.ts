import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { StatusGateway } from "@/engine/gateway";
import { useEngineScope } from "@/engine/scope";
import type {
  EngineSyncRun,
  EngineSyncSchedule,
  EngineSyncState,
  InstanceLiveState,
  ReadOptions,
} from "@/engine/types";
import { useOptimisticInstanceQueryFor } from "@/hooks/use-optimistic-instance-query";
import { withPlainError } from "./errors";
import { fromInstanceId } from "./ids";
import { useMappedValue } from "./mapped";
import { useInstanceAction, useScopeInstanceId } from "./scope";

function useCapabilitiesRequest() {
  const get = useInstanceAction(api.engineCapabilities.get);
  return useCallback(() => get({}).catch(withPlainError), [get]);
}

function useEngineInfoRequest() {
  const getEngineInfo = useInstanceAction(api.engineInfo.getEngineInfo);
  return useCallback(() => getEngineInfo({}), [getEngineInfo]);
}

function useSetOverlayPublicUrlRequest() {
  const setOverlayPublicUrl = useInstanceAction(api.engineInfo.setOverlayPublicUrl);
  return useCallback((value: string) => setOverlayPublicUrl({ value }), [setOverlayPublicUrl]);
}

// The URL names the engine, so this one call needs no scope and works
// outside EngineGatewayProvider, before any instance exists.
function useConnectionTestRequest() {
  const testConnection = useAction(api.engineHealth.testConnection);
  return useCallback((url: string) => testConnection({ url }), [testConnection]);
}

function useObsStatusRequest() {
  const get = useInstanceAction(api.obsStatus.get);
  return useCallback(() => get({}), [get]);
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

function useLiveState() {
  const { optimisticInstanceId, isInstanceLoading } = useEngineScope();
  const row = useOptimisticInstanceQueryFor(
    api.instanceLiveState.getForInstance,
    optimisticInstanceId ? fromInstanceId(optimisticInstanceId) : null,
    isInstanceLoading
  );
  return useMappedValue(row, toInstanceLiveState);
}

function useLiveStatePollRequest() {
  const pollLiveState = useInstanceAction(api.streamStatus.pollLiveState);
  return useCallback(() => pollLiveState({}), [pollLiveState]);
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

function useSyncState({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const state = useQuery(api.engineSync.getSyncState, enabled && instanceId ? { instanceId } : "skip");
  return useMappedValue(state, toEngineSyncState);
}

function useSyncRequest() {
  const syncNow = useInstanceAction(api.engineSync.syncNow);
  return useCallback(() => syncNow({}), [syncNow]);
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
