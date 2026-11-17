import type { OrgCapabilities } from "@convex/organizations";

export const ACCOUNT_PORTAL_PATH = "/account";

export type PortalPageId = "plan" | "payments" | "people" | "engines" | "settings" | "team";

export interface PortalPage {
  id: PortalPageId;
  label: string;
  path: string;
  /** The org action a role needs to see the page; null means every signed-in user sees it. */
  visibleWith: keyof OrgCapabilities | null;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  { id: "plan", label: "Plan", path: ACCOUNT_PORTAL_PATH, visibleWith: null },
  { id: "payments", label: "Payments", path: `${ACCOUNT_PORTAL_PATH}/payments`, visibleWith: null },
  { id: "people", label: "People", path: `${ACCOUNT_PORTAL_PATH}/people`, visibleWith: "manageMembers" },
  { id: "engines", label: "Engines", path: `${ACCOUNT_PORTAL_PATH}/engines`, visibleWith: "viewOrganization" },
  { id: "settings", label: "Your settings", path: `${ACCOUNT_PORTAL_PATH}/settings`, visibleWith: null },
  { id: "team", label: "Team", path: `${ACCOUNT_PORTAL_PATH}/team`, visibleWith: null },
];

/** The pages a viewer sees in the portal's nav; `can` is null for a viewer with no organization. */
export function visiblePages(can: OrgCapabilities | null): PortalPage[] {
  return PORTAL_PAGES.filter((page) => page.visibleWith === null || can?.[page.visibleWith] === true);
}

export function portalPage(id: PortalPageId): PortalPage {
  const page = PORTAL_PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) {
    throw new Error(`No portal page ${id}`);
  }
  return page;
}

/** Whether a portal tab is the current one; the index matches only exactly, so `/account` is not active on `/account/payments`. */
export function isActivePage(location: string, path: string): boolean {
  if (path === ACCOUNT_PORTAL_PATH) {
    return location === ACCOUNT_PORTAL_PATH;
  }
  return location === path || location.startsWith(`${path}/`);
}
