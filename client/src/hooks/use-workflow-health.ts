import type { Id } from "@convex/_generated/dataModel";
import { useEffect, useMemo } from "react";
import { useEngineHealth } from "@/engine/hooks/use-engine-health";
import { useNotRunningWorkflowList, useWorkflowHealthResyncRequest } from "@/engine/hooks/use-workflows";
import { useInstance } from "@/hooks/use-instance";
import { type NotRunningWorkflow, notRunningById } from "@/lib/workflow-health";

/**
 * Enabled workflows the engine is not running on their own, by engine workflow
 * id. Every caller shares one Convex subscription, so a page may call this from
 * as many components as it likes.
 */
export function useNotRunningWorkflows(): {
  byId: ReadonlyMap<string, NotRunningWorkflow>;
  list: readonly NotRunningWorkflow[] | undefined;
} {
  const { instance } = useInstance();
  const list = useNotRunningWorkflowList(instance ? (instance._id as Id<"instances">) : null);
  const byId = useMemo(() => notRunningById(list), [list]);
  return { byId, list };
}

/**
 * Ask the engine for current health once, when the calling screen mounts. The
 * server throttles per instance, so this is safe to call on every mount.
 */
export function useWorkflowHealthResyncOnMount(): void {
  const { instance } = useInstance();
  const resync = useWorkflowHealthResyncRequest();
  const instanceId = instance?._id as Id<"instances"> | undefined;

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    resync(instanceId, "mount").catch(() => undefined);
  }, [instanceId, resync]);
}

/**
 * Ask the engine for current health each time the live engine session comes
 * up. A drop and reconnect is when webhooks are most likely to have been
 * missed (the engine may have restarted); the server throttles repeats.
 */
export function useWorkflowHealthResyncOnReconnect(): void {
  const { instance } = useInstance();
  const { connected } = useEngineHealth();
  const resync = useWorkflowHealthResyncRequest();
  const instanceId = instance?._id as Id<"instances"> | undefined;

  useEffect(() => {
    if (!instanceId || !connected) {
      return;
    }
    resync(instanceId, "reconnect").catch(() => undefined);
  }, [instanceId, connected, resync]);
}
