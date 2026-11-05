import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { engineBuildStalled } from "@convex/lib/firstRun";
import type { SetupStatus } from "@convex/setup";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { type EngineBuild, engineBuildMessage, engineBuildPercent } from "@/lib/engine-build";

/** The instance's engine build as the waiting screens show it, from its provisioning row. */
export function useEngineBuild(
  instanceId: Id<"instances">,
  {
    engineRegistered,
    managedEngine,
    completedAt,
  }: Pick<SetupStatus, "engineRegistered" | "managedEngine" | "completedAt">
): EngineBuild {
  const now = useMinuteClock();
  const provisioning = useQuery(api.provisioning.forInstance, engineRegistered ? "skip" : { instanceId });
  const retryAction = useAction(api.provisioning.retry);
  const retry = useCallback(async () => {
    await retryAction({ instanceId });
  }, [retryAction, instanceId]);

  return useMemo((): EngineBuild => {
    if (engineRegistered) {
      return { stage: "ready" };
    }
    if (provisioning !== undefined && engineBuildStalled({ provisioning, managedEngine, completedAt, now })) {
      return { stage: "failed", retry };
    }
    return {
      stage: "building",
      message: engineBuildMessage(provisioning?.status),
      percent: engineBuildPercent(provisioning?.steps ?? []),
    };
  }, [engineRegistered, managedEngine, completedAt, now, provisioning, retry]);
}
