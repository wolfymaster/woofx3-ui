import type { OrgCapabilities } from "@convex/organizations";

export const ORG_PORTAL_PATH = "/org";

export type PortalPageId = "plan" | "payments" | "people" | "engines";

export interface PortalPage {
  id: PortalPageId;
  label: string;
  path: string;
  /** The org action a role needs to see the page; its query answers null to everyone else. */
  visibleWith: keyof OrgCapabilities;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  { id: "plan", label: "Plan", path: ORG_PORTAL_PATH, visibleWith: "viewBilling" },
  { id: "payments", label: "Payments", path: `${ORG_PORTAL_PATH}/payments`, visibleWith: "manageBilling" },
  { id: "people", label: "People", path: `${ORG_PORTAL_PATH}/people`, visibleWith: "manageMembers" },
  { id: "engines", label: "Engines", path: `${ORG_PORTAL_PATH}/engines`, visibleWith: "viewOrganization" },
];

/** The pages a role sees in the portal's nav. */
export function visiblePages(can: OrgCapabilities): PortalPage[] {
  return PORTAL_PAGES.filter((page) => can[page.visibleWith]);
}

export function portalPage(id: PortalPageId): PortalPage {
  const page = PORTAL_PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) {
    throw new Error(`No portal page ${id}`);
  }
  return page;
}

/** Whether a portal tab is the current one; the index matches only exactly, so `/org` is not active on `/org/payments`. */
export function isActivePage(location: string, path: string): boolean {
  if (path === ORG_PORTAL_PATH) {
    return location === ORG_PORTAL_PATH;
  }
  return location === path || location.startsWith(`${path}/`);
}
