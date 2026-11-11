import { api } from "@convex/_generated/api";
import { useStore } from "@nanostores/react";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import type { Live, OrganizationAccess } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";
import { useInstanceRole } from "@/hooks/use-instance-role";
import { useLogger } from "@/lib/logger-context";
import { $engineUrl } from "@/lib/stores";
import { transport } from "@/lib/transport";
import { $engineConnected } from "@/lib/transport/engine-connection";
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

  useCapabilitiesRefresh();
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
  const connected = useStore($engineConnected);
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

// The transport is a module singleton, so this keeps its identity without memoising.
const reconnectNow = (): void => {
  transport.reconnectNow();
};

function useConnected(): boolean {
  return useStore($engineConnected);
}

function useOrganizationAccess(): Live<OrganizationAccess | null> {
  const instanceId = useScopeInstanceId();
  return useQuery(api.organizations.capabilitiesForInstance, instanceId ? { instanceId } : "skip");
}

export const convexSessionGateway: SessionGateway = {
  useLiveConnection,
  useReconnectRequest: () => reconnectNow,
  useConnected,
  useCapabilities,
  useRole: useInstanceRole,
  useOrganizationAccess,
};
