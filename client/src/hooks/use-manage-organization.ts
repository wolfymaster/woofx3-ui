import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useInstance } from "@/hooks/use-instance";
import { useMinuteClock } from "@/hooks/use-minute-clock";
import { useBillingUi } from "@/lib/feature-source";

/**
 * Whether to offer "Manage organization": to the org's owners and admins, on
 * a hosted engine, in the web build only (the desktop app never shows billing).
 */
export function useCanManageOrganization(): boolean {
  const { visible } = useBillingUi();
  const { instance } = useInstance();
  const now = useMinuteClock();
  const organizations = useQuery(api.organizations.mine, visible ? { now } : "skip");
  const organization = organizations?.find((org) => org.accountId === instance?.accountId);
  return visible && organization !== undefined && organization.can.manageMembers;
}
