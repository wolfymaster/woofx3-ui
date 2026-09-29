import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useStore } from "@nanostores/react";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo } from "react";
import { useInstance } from "@/hooks/use-instance";
import { $engineConnected } from "@/lib/transport/engine-connection";
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
  const list = useQuery(
    api.workflowHealth.listNotRunning,
    instance ? { instanceId: instance._id as Id<"instances"> } : "skip"
  );
  const byId = useMemo(() => notRunningById(list), [list]);
  return { byId, list };
}

/**
 * Ask the engine for current health once, when the calling screen mounts. The
 * server throttles per instance, so this is safe to call on every mount.
 */
export function useWorkflowHealthResyncOnMount(): void {
  const { instance } = useInstance();
  const resync = useAction(api.workflowHealth.resync);
  const instanceId = instance?._id as Id<"instances"> | undefined;

  useEffect(() => {
    if (!instanceId) {
      return;
    }
    resync({ instanceId, trigger: "mount" }).catch(() => undefined);
  }, [instanceId, resync]);
}

/**
 * Ask the engine for current health each time the live engine session comes
 * up. A drop and reconnect is when webhooks are most likely to have been
 * missed (the engine may have restarted); the server throttles repeats.
 */
export function useWorkflowHealthResyncOnReconnect(): void {
  const { instance } = useInstance();
  const connected = useStore($engineConnected);
  const resync = useAction(api.workflowHealth.resync);
  const instanceId = instance?._id as Id<"instances"> | undefined;

  useEffect(() => {
    if (!instanceId || !connected) {
      return;
    }
    resync({ instanceId, trigger: "reconnect" }).catch(() => undefined);
  }, [instanceId, connected, resync]);
}
