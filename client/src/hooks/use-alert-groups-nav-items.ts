import { ALERT_GROUPS_ITEM, type NavItem } from "@/components/layout/nav-config";
import { useWorkflowGroupsSupported } from "@/engine/hooks/use-workflow-groups";

const NONE: NavItem[] = [];
const OFFERED: NavItem[] = [ALERT_GROUPS_ITEM];

/** The Alert Groups entry on an engine that has alert groups; nothing on one that doesn't. */
export function useAlertGroupsNavItems(): NavItem[] {
  return useWorkflowGroupsSupported() ? OFFERED : NONE;
}
