import { useEngineGateway } from "@/engine/context";
import { useCapabilitiesReconnectReset } from "@/engine/hooks/use-engine-capabilities";

/**
 * Keeps the live connection pointed at the current instance's engine, and
 * drops what was cached about the engine when it reconnects (an engine
 * restarts on an update). Mounted once, by the app shell.
 */
export function useLiveConnection(): void {
  useEngineGateway().session.useLiveConnection();
  useCapabilitiesReconnectReset();
}

/** Retries a dropped live connection now instead of waiting out its backoff. */
export function useLiveReconnectRequest() {
  return useEngineGateway().session.useReconnectRequest();
}
