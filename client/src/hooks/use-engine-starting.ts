import { api } from "@convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { engineBuildPhaseLabel } from "@/lib/engine-build";

/**
 * Whether the current instance's managed engine is still being built, with the
 * friendly name of the phase it is in. Null once the engine has registered.
 * The server decides (`access.entry`), so the dashboard gate and the status
 * bar never disagree.
 */
export function useEngineStarting(): { phase: string } | null {
  const { isAuthenticated } = useConvexAuth();
  const { instance, optimisticInstanceId } = useInstance();
  const entry = useQuery(api.access.entry, isAuthenticated ? { selectedInstanceId: optimisticInstanceId } : "skip");
  const starting = entry?.kind === "engine" && entry.starting && entry.instanceId === instance?._id;
  const provisioning = useQuery(
    api.provisioning.forInstance,
    starting && instance ? { instanceId: instance._id } : "skip"
  );
  if (!starting) {
    return null;
  }
  return { phase: engineBuildPhaseLabel(provisioning?.status, provisioning?.steps ?? []) };
}
