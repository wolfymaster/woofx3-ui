import { type ReactNode, useMemo } from "react";
import { convexEngineGateway } from "@/engine/convex/gateway";
import { toInstanceId } from "@/engine/convex/ids";
import type { EngineGateway } from "@/engine/gateway";
import { EngineScopeProvider } from "@/engine/scope";
import type { EngineScope } from "@/engine/types";
import { useInstance } from "@/hooks/use-instance";

/** The hosted app's gateway: the engine reached through Convex. */
export const hostedEngineGateway: EngineGateway = convexEngineGateway;

/**
 * Holds the selected instance as the engine scope, so no engine call carries
 * an instance id. Mounted around the app shell and the setup wizard.
 */
export function InstanceEngineScope({ children }: { children: ReactNode }) {
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
  return <EngineScopeProvider scope={scope}>{children}</EngineScopeProvider>;
}
