import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useQuery } from "convex/react";
import { useCallback, useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import type { Live, OrganizationAccess } from "@/engine/types";
import { useLogger } from "@/lib/logger-context";
import { $documentVisible } from "@/lib/stores";
import { startVisibleInterval } from "@/lib/visible-interval";
import { $engineReachable, ENGINE_PROBE_INTERVAL_MS } from "./engine-reachable";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// There is no connection to the engine from the browser: Convex holds the
// instance's credentials and makes every call, so "live" here means probing
// that the engine answers and reading its capabilities once it does.

function useLiveConnection(): void {
  useEngineProbe();
  useCapabilitiesRefresh();
}

/** A function that asks Convex whether the engine answers and records the result. */
function useProbeRequest(): () => Promise<void> {
  const health = useInstanceAction(api.engineLive.health);
  return useCallback(async () => {
    try {
      $engineReachable.set((await health({})).connected);
    } catch {
      // Not being able to ask is the same, to a reader, as the engine not answering.
      $engineReachable.set(false);
    }
  }, [health]);
}

/** Probes on mount and then on a cadence while the tab is visible; a different instance starts from not reachable. */
function useEngineProbe(): void {
  const instanceId = useScopeInstanceId();
  const probe = useProbeRequest();
  useEffect(() => {
    if (instanceId === null) {
      $engineReachable.set(false);
      return;
    }
    void probe();
    return startVisibleInterval(() => void probe(), ENGINE_PROBE_INTERVAL_MS, $documentVisible);
  }, [instanceId, probe]);
}

/**
 * Asks the engine for its capabilities each time the live connection comes
 * up, which is also what happens when the instance or its engine changes.
 * Mounted once, with the live connection, so the whole dashboard costs one
 * engine call per connection; every gate reads the stored answer.
 */
function useCapabilitiesRefresh(): void {
  const logger = useLogger();
  const instanceId = useScopeInstanceId();
  const connected = useStore($engineReachable);
  const refresh = useInstanceAction(api.engineCapabilities.refresh);

  useEffect(() => {
    if (!connected || instanceId === null) {
      return;
    }
    refresh({}).catch((error: unknown) => {
      logger.warn("Could not read the engine's capabilities; gates keep the last answer", { error });
    });
  }, [connected, instanceId, refresh, logger]);
}

function useCapabilities(): Live<readonly string[]> {
  const instanceId = useScopeInstanceId();
  const capabilities = useQuery(api.engineCapabilities.get, instanceId ? { instanceId } : "skip");
  if (capabilities === undefined) {
    return undefined;
  }
  return capabilities ?? [];
}

function useConnected(): boolean {
  return useStore($engineReachable);
}

function useOrganizationAccess(): Live<OrganizationAccess | null> {
  const instanceId = useScopeInstanceId();
  return useQuery(api.organizations.capabilitiesForInstance, instanceId ? { instanceId } : "skip");
}

export const convexSessionGateway: SessionGateway = {
  useLiveConnection,
  useReconnectRequest: useProbeRequest,
  useConnected,
  useCapabilities,
  useOrganizationAccess,
};
