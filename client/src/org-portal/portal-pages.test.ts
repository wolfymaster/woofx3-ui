import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@convex/lib/organization";
import { ORG_ACTIONS, orgCan } from "@convex/lib/orgRoles";
import type { OrgCapabilities } from "@convex/organizations";
import { isActivePage, ORG_PORTAL_PATH, type PortalPageId, portalPage, visiblePages } from "./portal-pages";

function can(role: OrgRole): OrgCapabilities {
  return Object.fromEntries(ORG_ACTIONS.map((action) => [action, orgCan(role, action)])) as OrgCapabilities;
}

// The "Who sees what" table: a page a role can't see isn't in its nav.
const NAV: Array<[OrgRole, PortalPageId[]]> = [
  ["owner", ["plan", "payments", "people", "engines"]],
  ["admin", ["plan", "people", "engines"]],
  ["member", ["engines"]],
];

describe("visiblePages", () => {
  for (const [role, pages] of NAV) {
    test(`${role} sees ${pages.join(", ")}`, () => {
      expect(visiblePages(can(role)).map((page) => page.id)).toEqual(pages);
    });
  }
});

describe("portalPage", () => {
  test("the Plan tab is the index, the rest are nested", () => {
    expect(portalPage("plan").path).toBe(ORG_PORTAL_PATH);
    expect(portalPage("payments").path).toBe(`${ORG_PORTAL_PATH}/payments`);
  });
});

describe("isActivePage", () => {
  test("the index is active only on exactly the index", () => {
    expect(isActivePage(ORG_PORTAL_PATH, ORG_PORTAL_PATH)).toBe(true);
    expect(isActivePage(`${ORG_PORTAL_PATH}/payments`, ORG_PORTAL_PATH)).toBe(false);
  });

  test("a nested tab stays active under its own subtree", () => {
    expect(isActivePage(`${ORG_PORTAL_PATH}/payments`, `${ORG_PORTAL_PATH}/payments`)).toBe(true);
    expect(isActivePage(`${ORG_PORTAL_PATH}/payments/42`, `${ORG_PORTAL_PATH}/payments`)).toBe(true);
    expect(isActivePage(`${ORG_PORTAL_PATH}/people`, `${ORG_PORTAL_PATH}/payments`)).toBe(false);
  });
});
