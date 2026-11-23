import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useQuery } from "convex/react";
import { useCallback, useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import type { Live, OrganizationAccess } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";
import { useLogger } from "@/lib/logger-context";
import { $documentVisible, $engineUrl } from "@/lib/stores";
import { transport } from "@/lib/transport";
import { startVisibleInterval } from "@/lib/visible-interval";
import { $engineReachable, ENGINE_PROBE_INTERVAL_MS } from "./engine-reachable";
import { useInstanceAction, useScopeInstanceId } from "./scope";

// The live connection is the browser transport's WebSocket session, opened
// with the URL and client credentials Convex recorded for the instance at
// registration. `$engineUrl` stands in for an instance with no URL, for local
// overrides.

function useLiveConnection(): void {
  const { instance, isLoading } = useInstance();
  const fallbackUrl = useStore($engineUrl);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const urlFromInstance = instance?.url?.trim();
    const url = urlFromInstance && urlFromInstance.length > 0 ? urlFromInstance : fallbackUrl;
    const clientId = instance?.clientId ?? undefined;
    const clientSecret = instance?.clientSecret ?? undefined;

    transport.connect(url, clientId, clientSecret);
  }, [isLoading, instance, fallbackUrl]);

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
