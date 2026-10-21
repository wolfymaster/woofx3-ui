import { useStore } from "@nanostores/react";
import { useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import { useInstance } from "@/hooks/use-instance";
import { $engineUrl } from "@/lib/stores";
import { transport } from "@/lib/transport";

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
}

// The transport is a module singleton, so this keeps its identity without memoising.
const reconnectNow = (): void => {
  transport.reconnectNow();
};

export const convexSessionGateway: SessionGateway = {
  useLiveConnection,
  useReconnectRequest: () => reconnectNow,
};
