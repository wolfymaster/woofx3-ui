import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { $apiKey, $engineUrl } from "@/lib/stores";
import { transport } from "@/lib/transport";
import { useInstance } from "@/hooks/use-instance";

/**
 * Keeps the browser/Tauri engine transport aligned with the selected Convex instance.
 * Each instance has its own engine URL (and optional API key from registration); the global
 * `$engineUrl` / `$apiKey` stores are fallbacks for legacy UX and local overrides.
 */
export function useSyncEngineTransport(): void {
  const { instance, isLoading } = useInstance();
  const fallbackUrl = useStore($engineUrl);
  const fallbackKey = useStore($apiKey);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const urlFromInstance = instance?.url?.trim();
    const url = urlFromInstance && urlFromInstance.length > 0 ? urlFromInstance : fallbackUrl;
    const apiKey = instance?.apiKey?.trim() ? instance.apiKey : fallbackKey;

    transport.connect(url, apiKey || undefined);
  }, [isLoading, instance, fallbackUrl, fallbackKey]);
}
