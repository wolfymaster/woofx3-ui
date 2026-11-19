import type { OrgCapabilities } from "@convex/organizations";
import type { PortalScope } from "./portal-scope";

export const ACCOUNT_PORTAL_PATH = "/account";

export const PLANS_PATH = `${ACCOUNT_PORTAL_PATH}/organization/plans`;

export type PortalPageId = "overview" | "sponsorship" | "payments" | "settings" | "team" | "general" | "plans";

export interface PortalPage {
  id: PortalPageId;
  label: string;
  path: string;
  /** The scopes whose nav lists the page: a person's own things are personal, the organization's are not. */
  scopes: readonly PortalScope["kind"][];
  /** The org action a role needs to see the page; null means every signed-in user sees it. */
  visibleWith: keyof OrgCapabilities | null;
  /** Pages of an organization's Settings sit under that entry in the nav. */
  inOrganizationSettings?: boolean;
}

export const PORTAL_PAGES: readonly PortalPage[] = [
  {
    id: "overview",
    label: "Overview",
    path: ACCOUNT_PORTAL_PATH,
    scopes: ["personal", "organization"],
    visibleWith: null,
  },
  {
    id: "sponsorship",
    label: "Sponsorship",
    path: `${ACCOUNT_PORTAL_PATH}/sponsorship`,
    scopes: ["personal"],
    visibleWith: null,
  },
  {
    id: "payments",
    label: "Payments",
    path: `${ACCOUNT_PORTAL_PATH}/payments`,
    scopes: ["organization"],
    visibleWith: "manageBilling",
  },
  {
    id: "settings",
    label: "Your settings",
    path: `${ACCOUNT_PORTAL_PATH}/settings`,
    scopes: ["personal"],
    visibleWith: null,
  },
  {
    id: "team",
    label: "Team",
    path: `${ACCOUNT_PORTAL_PATH}/team`,
    scopes: ["organization"],
    visibleWith: "manageMembers",
  },
  {
    id: "general",
    label: "General",
    path: `${ACCOUNT_PORTAL_PATH}/organization/general`,
    scopes: ["organization"],
    visibleWith: "viewOrganization",
    inOrganizationSettings: true,
  },
  {
    id: "plans",
    label: "Plans",
    path: PLANS_PATH,
    scopes: ["organization"],
    visibleWith: "manageBilling",
    inOrganizationSettings: true,
  },
];

/** The pages a viewer sees in the portal's nav for a scope; `can` is null for a viewer with no organization. */
export function visiblePages(scope: PortalScope["kind"], can: OrgCapabilities | null): PortalPage[] {
  return PORTAL_PAGES.filter(
    (page) => page.scopes.includes(scope) && (page.visibleWith === null || can?.[page.visibleWith] === true)
  );
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
