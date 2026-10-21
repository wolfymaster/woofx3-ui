import { createContext, type ReactNode, useContext, useMemo } from "react";
import { convexEngineGateway } from "@/engine/convex/gateway";
import { toInstanceId } from "@/engine/convex/ids";
import type { EngineGateway } from "@/engine/gateway";
import type { EngineScope } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";

/**
 * The gateway this app runs with, fixed at boot. Swapping it while mounted
 * would change which hooks components call between renders.
 */
const bootGateway: EngineGateway = convexEngineGateway;

// The gateway is the context's default rather than a provider value, so
// engine calls that need no current instance (the setup wizard, which runs
// outside the shell) can reach it too.
const EngineGatewayContext = createContext<EngineGateway>(bootGateway);
const EngineScopeContext = createContext<EngineScope | null>(null);

/**
 * Holds the current instance for the engine hooks below it, so they need no
 * instance id of their own. Mounted by the broadcast shell.
 */
export function EngineGatewayProvider({ children }: { children: ReactNode }) {
  const { instance, optimisticInstanceId, isLoading } = useInstance();
  const instanceId = toInstanceId(instance?._id) ?? null;
  const scope = useMemo(
    (): EngineScope => ({
      instanceId,
      optimisticInstanceId: toInstanceId(optimisticInstanceId),
      isInstanceLoading: isLoading,
    }),
    [instanceId, optimisticInstanceId, isLoading]
  );
  return (
    <EngineGatewayContext.Provider value={bootGateway}>
      <EngineScopeContext.Provider value={scope}>{children}</EngineScopeContext.Provider>
    </EngineGatewayContext.Provider>
  );
}

export function useEngineGateway(): EngineGateway {
  return useContext(EngineGatewayContext);
}

/** The current instance as the provider sees it. Throws outside `EngineGatewayProvider`. */
export function useEngineScope(): EngineScope {
  const scope = useContext(EngineScopeContext);
  if (!scope) {
    throw new Error("useEngineScope: no EngineGatewayProvider above this component");
  }
  return scope;
}
