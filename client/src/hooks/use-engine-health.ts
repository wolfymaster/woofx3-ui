import { useStore } from "@nanostores/react";
import { $engineConnected } from "@/lib/transport/engine-connection";

/**
 * Engine reachability as the live transport session sees it. The session
 * already pings on connect and reports a dropped socket, so this costs no
 * request of its own; Admin > Engine keeps an explicit Convex-side test for
 * when the user asks.
 */
export function useEngineHealth(): { connected: boolean } {
  const connected = useStore($engineConnected);
  return { connected };
}
