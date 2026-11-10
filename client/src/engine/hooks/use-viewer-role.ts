import type { InstanceRole } from "@convex/lib/instanceRoles";
import { useEngineGateway } from "@/engine/context";

/** The caller's role on the scope's instance: undefined while loading, null when they hold none. */
export function useViewerRole(): InstanceRole | null | undefined {
  return useEngineGateway().session.useRole();
}
