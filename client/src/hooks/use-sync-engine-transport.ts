import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { $engineUrl } from "@/lib/stores";
import { transport } from "@/lib/transport";
import { useInstance } from "@/hooks/use-instance";

/**
 * Keeps the browser/Tauri engine transport aligned with the selected Convex instance.
 * Each instance has its own engine URL and client credentials from registration.
 * The global `$engineUrl` store is a fallback for legacy UX and local overrides.
 */
export function useSyncEngineTransport(): void {
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
