import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@convex/lib/organization";
import { ORG_ACTIONS, orgCan } from "@convex/lib/orgRoles";
import type { OrgCapabilities } from "@convex/organizations";
import { ACCOUNT_PORTAL_PATH, isActivePage, type PortalPageId, portalPage, visiblePages } from "./portal-pages";

function can(role: OrgRole): OrgCapabilities {
  return Object.fromEntries(ORG_ACTIONS.map((action) => [action, orgCan(role, action)])) as OrgCapabilities;
}

// The "Who sees what" table: a page a role can't see isn't in its nav.
const NAV: Array<[OrgRole, PortalPageId[]]> = [
  ["owner", ["overview", "sponsorship", "payments", "people", "settings", "team"]],
  ["admin", ["overview", "sponsorship", "payments", "people", "settings", "team"]],
  ["member", ["overview", "sponsorship", "payments", "settings", "team"]],
];

describe("visiblePages", () => {
  for (const [role, pages] of NAV) {
    test(`${role} sees ${pages.join(", ")}`, () => {
      expect(visiblePages(can(role)).map((page) => page.id)).toEqual(pages);
    });
  }
});

describe("visiblePages without an organization", () => {
  test("shows the personal pages only", () => {
    expect(visiblePages(null).map((page) => page.id)).toEqual([
      "overview",
      "sponsorship",
      "payments",
      "settings",
      "team",
    ]);
  });
});

describe("portalPage", () => {
  test("the Overview tab is the index, the rest are nested", () => {
    expect(ACCOUNT_PORTAL_PATH).toBe("/account");
    expect(portalPage("overview").path).toBe(ACCOUNT_PORTAL_PATH);
    expect(portalPage("payments").path).toBe(`${ACCOUNT_PORTAL_PATH}/payments`);
  });
});

describe("isActivePage", () => {
  test("the index is active only on exactly the index", () => {
    expect(isActivePage(ACCOUNT_PORTAL_PATH, ACCOUNT_PORTAL_PATH)).toBe(true);
    expect(isActivePage(`${ACCOUNT_PORTAL_PATH}/payments`, ACCOUNT_PORTAL_PATH)).toBe(false);
  });

  test("a nested tab stays active under its own subtree", () => {
    expect(isActivePage(`${ACCOUNT_PORTAL_PATH}/payments`, `${ACCOUNT_PORTAL_PATH}/payments`)).toBe(true);
    expect(isActivePage(`${ACCOUNT_PORTAL_PATH}/payments/42`, `${ACCOUNT_PORTAL_PATH}/payments`)).toBe(true);
    expect(isActivePage(`${ACCOUNT_PORTAL_PATH}/people`, `${ACCOUNT_PORTAL_PATH}/payments`)).toBe(false);
  });
});
