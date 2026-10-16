import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useEffect } from "react";
import { useEngineCapabilities } from "@/hooks/use-engine-capabilities";
import { useInstance } from "@/hooks/use-instance";
import { ALERT_LIBRARY_CAPABILITIES } from "@/lib/engine-capabilities";

export interface AlertLibrary {
  /** The engine stores an alert library. Everything below is offered only then. */
  enabled: boolean;
  /** The library by name, undefined while loading or while not enabled. */
  alerts: Doc<"alertCompositions">[] | undefined;
}

/** Instances whose cache was caught up with the engine this page session. */
const refreshed = new Set<string>();

/**
 * The instance's alert library, from the cache the engine's webhooks keep.
 * The first use per page session also reads the engine's whole library into
 * the cache, for alerts it holds that no webhook brought (made before the
 * dashboard cached them, or while it was unreachable).
 */
export function useAlertLibrary(): AlertLibrary {
  const { instance } = useInstance();
  const instanceId = instance?._id;
  const enabled = useEngineCapabilities(instanceId).support(...ALERT_LIBRARY_CAPABILITIES) === "supported";
  const alerts = useQuery(api.alertCompositions.list, enabled && instanceId ? { instanceId } : "skip");
  const refresh = useAction(api.alertCompositionActions.refresh);

  useEffect(() => {
    if (!enabled || !instanceId || refreshed.has(instanceId)) {
      return;
    }
    refreshed.add(instanceId);
    refresh({ instanceId }).catch((error: unknown) => {
      // The cache still has whatever the webhooks brought; the next editor to mount tries again.
      refreshed.delete(instanceId);
      console.warn("[alert library] refresh failed", error);
    });
  }, [enabled, instanceId, refresh]);

  return { enabled, alerts: enabled ? alerts : undefined };
}
