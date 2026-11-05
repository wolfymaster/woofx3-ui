import { useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import { directKeys as k } from "./keys";
import { type EngineRead, useConnected, useEngineQuery } from "./query";
import type { DirectRuntime } from "./runtime";

/**
 * Cached like every direct read: asked once per session, and asked again when
 * a resync invalidates the cache (a new session, or a new engine).
 */
function capabilitiesRead(runtime: DirectRuntime): EngineRead<readonly string[]> {
  return {
    queryKey: k.session.capabilities(),
    queryFn: async () =>
      (await runtime.call("getEngineCapabilities", (api) => api.getEngineCapabilities())).capabilities,
  };
}

/**
 * The live connection is the runtime's own engine session. Its engine and
 * credentials come from the runtime's target source, not from the scope:
 * the direct gateway is built for one engine.
 */
export function directSessionGateway(runtime: DirectRuntime): SessionGateway {
  const reconnectNow = (): void => {
    runtime.connection.session.reconnectNow();
  };

  return {
    useLiveConnection: () => {
      useEffect(() => {
        runtime.start();
        return () => {
          void runtime.stop();
        };
      }, [runtime.start, runtime.stop]);
    },
    useReconnectRequest: () => reconnectNow,
    useConnected: () => useConnected(runtime),
    useCapabilities: () => useEngineQuery(runtime, capabilitiesRead(runtime)),
  };
}
