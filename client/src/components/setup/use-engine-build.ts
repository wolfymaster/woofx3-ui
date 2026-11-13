import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { engineBuildStalled } from "@convex/lib/firstRun";
import type { SetupStatus } from "@convex/setup";
import { useAction, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import {
  type EngineBuild,
  engineBuildElapsedMinutes,
  engineBuildIsSlow,
  engineBuildMessage,
  engineBuildNote,
  engineBuildPercent,
  engineBuildPhaseDetail,
  engineBuildPhases,
} from "@/lib/engine-build";

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
    const steps = provisioning?.steps ?? [];
    const elapsedMinutes = engineBuildElapsedMinutes(provisioning?.createdAt, now);
    return {
      stage: "building",
      message: engineBuildMessage(provisioning?.status),
      detail: engineBuildPhaseDetail(provisioning?.status, steps),
      percent: engineBuildPercent(steps),
      phases: engineBuildPhases(provisioning?.status, steps),
      elapsedMinutes,
      slow: engineBuildIsSlow(elapsedMinutes),
      note: engineBuildNote(steps),
    };
  }, [engineRegistered, managedEngine, completedAt, now, provisioning, retry]);
}
