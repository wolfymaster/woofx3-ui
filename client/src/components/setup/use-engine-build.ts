import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { type EngineBuild, engineBuildMessage, engineBuildPercent } from "@/lib/engine-build";

/** The instance's engine build as the waiting screens show it, from its provisioning row. */
export function useEngineBuild(instanceId: Id<"instances">, engineRegistered: boolean): EngineBuild {
  const provisioning = useQuery(api.provisioning.forInstance, engineRegistered ? "skip" : { instanceId });
  const retryAction = useAction(api.provisioning.retry);
  const retry = useCallback(async () => {
    await retryAction({ instanceId });
  }, [retryAction, instanceId]);

  return useMemo((): EngineBuild => {
    if (engineRegistered) {
      return { stage: "ready" };
    }
    if (provisioning?.status === "failed") {
      return { stage: "failed", retry };
    }
    return {
      stage: "building",
      message: engineBuildMessage(provisioning?.status),
      percent: engineBuildPercent(provisioning?.steps ?? []),
    };
  }, [engineRegistered, provisioning, retry]);
}
