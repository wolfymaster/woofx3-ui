import { useEngineGateway } from "@/engine/context";
import type { OrganizationAccess } from "@/engine/types";

/** What the caller may do in the organization that owns the scope's instance: undefined while loading, null when not in it. */
export function useOrganizationAccess(): OrganizationAccess | null | undefined {
  return useEngineGateway().session.useOrganizationAccess();
}
