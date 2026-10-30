import { useEffect } from "react";
import type { SessionGateway } from "@/engine/gateway";
import { useConnected } from "./query";
import type { DirectRuntime } from "./runtime";

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
  };
}
