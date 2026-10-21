import { useEffect, useMemo } from "react";
import { useEngineScope } from "@/engine/context";
import { useEngineHealth } from "@/engine/hooks/use-engine-health";
import { useNotRunningWorkflowList, useWorkflowHealthResyncRequest } from "@/engine/hooks/use-workflows";
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
  const list = useNotRunningWorkflowList();
  const byId = useMemo(() => notRunningById(list), [list]);
  return { byId, list };
}

/**
 * Ask the engine for current health once, when the calling screen mounts. The
 * server throttles per instance, so this is safe to call on every mount.
 */
export function useWorkflowHealthResyncOnMount(): void {
  const { instanceId } = useEngineScope();
  const resync = useWorkflowHealthResyncRequest();

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    resync("mount").catch(() => undefined);
  }, [instanceId, resync]);
}

/**
 * Ask the engine for current health each time the live engine session comes
 * up. A drop and reconnect is when webhooks are most likely to have been
 * missed (the engine may have restarted); the server throttles repeats.
 */
export function useWorkflowHealthResyncOnReconnect(): void {
  const { instanceId } = useEngineScope();
  const { connected } = useEngineHealth();
  const resync = useWorkflowHealthResyncRequest();

  useEffect(() => {
    if (!instanceId || !connected) {
      return;
    }
    resync("reconnect").catch(() => undefined);
  }, [instanceId, connected, resync]);
}
