import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { DefaultSeedGateway } from "@/engine/gateway";
import type { DefaultSeedStatus } from "@/engine/types";
import { useMappedValue } from "./mapped";
import { useInstanceMutation, useScopeInstanceId } from "./scope";

type StatusRow = NonNullable<FunctionReturnType<typeof api.defaultSeed.status>>;

export function toDefaultSeedStatus(row: StatusRow): DefaultSeedStatus {
  return {
    scene: { status: row.scene.status, engineSceneId: row.scene.engineSceneId, error: row.scene.error },
    alerts: row.alerts.map((alert) => ({
      itemId: alert.itemId,
      event: alert.event,
      status: alert.status,
      engineWorkflowId: alert.engineWorkflowId,
      error: alert.error,
    })),
    alertImagesOmitted: row.alertImagesOmitted,
  };
}

function useStatus() {
  const instanceId = useScopeInstanceId();
  const status = useQuery(api.defaultSeed.status, instanceId ? { instanceId } : "skip");
  return useMappedValue(status, toDefaultSeedStatus);
}

function useApplyRequest() {
  const retry = useInstanceMutation(api.setup.retryApply);
  return useCallback(async () => {
    await retry({});
  }, [retry]);
}

export const convexDefaultSeedGateway: DefaultSeedGateway = { useStatus, useApplyRequest };
