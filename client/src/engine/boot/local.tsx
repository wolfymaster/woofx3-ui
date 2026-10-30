import { createEngineBrowserSession, createEngineGatewaySession } from "@woofx3/api/client";
import { type ReactNode, useEffect, useState } from "react";
import { EngineGatewayProvider } from "@/engine/context";
import { DEFAULT_DIRECT_GATEWAY_CONFIG } from "@/engine/direct/config";
import type { DirectEngineApi } from "@/engine/direct/connection";
import { createDirectEngineGateway } from "@/engine/direct/gateway";
import { createDirectRuntime, type DirectRuntime } from "@/engine/direct/runtime";
import type { EngineGateway } from "@/engine/gateway";
import { EngineScopeProvider } from "@/engine/scope";
import type { EngineScope, InstanceId } from "@/engine/types";
import { consoleLogger, systemClock, systemRandom } from "@/lib/engine-session/system";
import type { EngineTargetSource } from "@/lib/engine-session/target";

/**
 * The scope's id for the one engine local mode runs. A lone engine has no
 * instance record; the scope only needs an id that is never null, so reads
 * load and requests run.
 */
const LOCAL_INSTANCE_ID = "local" as InstanceId;

const LOCAL_SCOPE: EngineScope = {
  instanceId: LOCAL_INSTANCE_ID,
  optimisticInstanceId: LOCAL_INSTANCE_ID,
  isInstanceLoading: false,
};

interface LocalEngine {
  runtime: DirectRuntime;
  gateway: EngineGateway;
}

/** The direct gateway over the engine `targets` names, on the browser's own clock, randomness and console. */
function createLocalEngine(targets: EngineTargetSource): LocalEngine {
  const runtime = createDirectRuntime({
    targets,
    open: (target) => createEngineBrowserSession<DirectEngineApi>(target.url, target.clientId, target.clientSecret),
    ping: async (url) => {
      await createEngineGatewaySession(url).ping();
    },
    clock: systemClock,
    random: systemRandom,
    logger: consoleLogger("engine"),
    config: DEFAULT_DIRECT_GATEWAY_CONFIG,
  });
  return { runtime, gateway: createDirectEngineGateway(runtime) };
}

/**
 * Talks to the engine `targets` names directly, for the desktop app's local
 * mode: the direct gateway at the root and a scope that always holds the one
 * engine. The connection starts on mount and stops on unmount, and `targets`
 * is read once, so a host that changes engines remounts this.
 */
export function LocalEngineGatewayProvider({
  targets,
  children,
}: {
  targets: EngineTargetSource;
  children: ReactNode;
}) {
  const [engine] = useState(() => createLocalEngine(targets));
  useEffect(() => {
    engine.runtime.start();
    return () => {
      void engine.runtime.stop();
    };
  }, [engine]);
  return (
    <EngineGatewayProvider gateway={engine.gateway}>
      <EngineScopeProvider scope={LOCAL_SCOPE}>{children}</EngineScopeProvider>
    </EngineGatewayProvider>
  );
}
