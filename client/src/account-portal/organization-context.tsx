import type { MyOrganization } from "@convex/organizations";
import { createContext, type ReactNode, useContext } from "react";
import type { PortalScope } from "./portal-scope";

export interface OrganizationSelection {
  organization: MyOrganization;
  organizations: MyOrganization[];
}

const OrganizationContext = createContext<OrganizationSelection | null>(null);

export function OrganizationProvider({ value, children }: { value: OrganizationSelection; children: ReactNode }) {
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

/** The organization the portal is showing, or null for a viewer who has none. */
export function useOptionalOrganization(): OrganizationSelection | null {
  return useContext(OrganizationContext);
}

/** The organization the portal is showing. Only pages inside the portal's layout call this. */
export function useOrganization(): OrganizationSelection {
  const selection = useContext(OrganizationContext);
  if (selection === null) {
    throw new Error("useOrganization needs the org portal's layout above it");
  }
  return selection;
}

export interface PortalScopeState {
  scope: PortalScope;
  organizations: MyOrganization[];
  selectScope: (scope: PortalScope) => void;
}

const PortalScopeContext = createContext<PortalScopeState | null>(null);

export function PortalScopeProvider({ value, children }: { value: PortalScopeState; children: ReactNode }) {
  return <PortalScopeContext.Provider value={value}>{children}</PortalScopeContext.Provider>;
}

/** Every organization the person is in and the scope the portal shows; null where no portal frame is above. */
export function useOptionalPortalScope(): PortalScopeState | null {
  return useContext(PortalScopeContext);
}
