import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { useInstance } from "@/hooks/use-instance";

const POLL_INTERVAL_MS = 20_000;

// Polls the engine's unauthenticated gateway.ping() on an interval — the
// engine exposes no push/webhook signal for "still reachable", so this is
// the only way to know connectivity is current rather than stale.
export function useEngineHealth(): { connected: boolean } {
  const { instance } = useInstance();
  const testConnection = useAction(api.engineHealth.testConnection);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);

    const url = instance?.url?.trim();
    if (!url) {
      return;
    }

    let cancelled = false;

    const check = async () => {
      const result = await testConnection({ url });
      if (!cancelled) {
        setConnected(result.ok);
      }
    };

    void check();
    const interval = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [instance?.url, testConnection]);

  return { connected };
}
