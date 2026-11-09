import type { OrgCapabilities } from "@convex/organizations";

export const ORG_PORTAL_PATH = "/org";

export type PortalPageId = "overview" | "billing" | "members" | "engines" | "invoices";

export interface PortalPage {
  id: PortalPageId;
  label: string;
  path: string;
  /** The org action a role needs to see the page; its query answers null to everyone else. */
  visibleWith: keyof OrgCapabilities;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  { id: "overview", label: "Overview", path: ORG_PORTAL_PATH, visibleWith: "viewOrganization" },
  { id: "billing", label: "Plan & billing", path: `${ORG_PORTAL_PATH}/billing`, visibleWith: "viewBilling" },
  { id: "members", label: "Members", path: `${ORG_PORTAL_PATH}/members`, visibleWith: "manageMembers" },
  { id: "engines", label: "Engines", path: `${ORG_PORTAL_PATH}/engines`, visibleWith: "viewOrganization" },
  { id: "invoices", label: "Discounts & invoices", path: `${ORG_PORTAL_PATH}/invoices`, visibleWith: "manageBilling" },
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
