import { useEngineGateway } from "@/engine/context";
import type { InstanceRole } from "@/engine/types";

/** The caller's role on the scope's instance: undefined while loading, null when they hold none. */
export function useViewerRole(): InstanceRole | null | undefined {
  return useEngineGateway().session.useRole();
}
