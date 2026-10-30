import { createContext, type ReactNode, useContext } from "react";
import type { EngineGateway } from "@/engine/gateway";

export { useEngineScope } from "@/engine/scope";

// Which gateway the app talks to is chosen once, at boot, by the wiring in
// client/src/engine/boot. Nothing here names an adapter, so the engine hooks
// and screens work the same over either.

const EngineGatewayContext = createContext<EngineGateway | null>(null);

/**
 * Makes `gateway` the one every engine hook below uses. Mounted once at the
 * root and never given another gateway: swapping it while mounted would
 * change which hooks components call between renders.
 */
export function EngineGatewayProvider({ gateway, children }: { gateway: EngineGateway; children: ReactNode }) {
  return <EngineGatewayContext.Provider value={gateway}>{children}</EngineGatewayContext.Provider>;
}

/** The gateway the app booted with. Throws outside `EngineGatewayProvider`. */
export function useEngineGateway(): EngineGateway {
  const gateway = useContext(EngineGatewayContext);
  if (!gateway) {
    throw new Error("useEngineGateway: no EngineGatewayProvider above this component");
  }
  return gateway;
}
