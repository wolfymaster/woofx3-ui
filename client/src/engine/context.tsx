import { createContext, type ReactNode, useContext, useMemo } from "react";
import { convexEngineGateway } from "@/engine/convex/gateway";
import { toInstanceId } from "@/engine/convex/ids";
import type { EngineGateway } from "@/engine/gateway";
import { EngineScopeProvider } from "@/engine/scope";
import type { EngineScope } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";

export { useEngineScope } from "@/engine/scope";

/**
 * The gateway this app runs with, fixed at boot. Swapping it while mounted
 * would change which hooks components call between renders.
 */
const bootGateway: EngineGateway = convexEngineGateway;

// The gateway is the context's default as well as the provider's value, so
// an engine call that needs no current instance works outside the provider.
const EngineGatewayContext = createContext<EngineGateway>(bootGateway);

/**
 * Holds the current instance for the engine hooks and the gateway below it,
 * so no call carries an instance id. Mounted around the app shell and the
 * setup wizard.
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
      <EngineScopeProvider scope={scope}>{children}</EngineScopeProvider>
    </EngineGatewayContext.Provider>
  );
}

export function useEngineGateway(): EngineGateway {
  return useContext(EngineGatewayContext);
}
