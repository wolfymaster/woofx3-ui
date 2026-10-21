import { useEngineGateway } from "@/engine/context";

/**
 * Engine reachability as the live connection sees it. The connection already
 * pings on connect and reports a dropped socket, so this costs no request of
 * its own; Admin > Engine keeps an explicit test for when the user asks.
 */
export function useEngineHealth(): { connected: boolean } {
  const connected = useEngineGateway().session.useConnected();
  return { connected };
}
