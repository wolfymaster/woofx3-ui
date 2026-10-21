import { useEngineGateway } from "@/engine/context";

/** Keeps the live connection pointed at the current instance's engine. Mounted once, by the app shell. */
export function useLiveConnection(): void {
  useEngineGateway().session.useLiveConnection();
}

/** Retries a dropped live connection now instead of waiting out its backoff. */
export function useLiveReconnectRequest() {
  return useEngineGateway().session.useReconnectRequest();
}
