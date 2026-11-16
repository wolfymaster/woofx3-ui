import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";
import { createContext, type ReactNode, useContext } from "react";

export interface OrganizationSelection {
  organization: MyOrganization;
  organizations: MyOrganization[];
  select: (accountId: Id<"accounts">) => void;
}

const OrganizationContext = createContext<OrganizationSelection | null>(null);

export function OrganizationProvider({ value, children }: { value: OrganizationSelection; children: ReactNode }) {
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

/** The organization the portal is showing. Only pages inside the portal's layout call this. */
export function useOrganization(): OrganizationSelection {
  const selection = useContext(OrganizationContext);
  if (selection === null) {
    throw new Error("useOrganization needs the org portal's layout above it");
  }
  return selection;
}
