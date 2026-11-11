import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@convex/lib/organization";
import { ORG_ACTIONS, orgCan } from "@convex/lib/orgRoles";
import type { OrgCapabilities } from "@convex/organizations";
import { type PortalPageId, visiblePages } from "./portal-pages";

function can(role: OrgRole): OrgCapabilities {
  return Object.fromEntries(ORG_ACTIONS.map((action) => [action, orgCan(role, action)])) as OrgCapabilities;
}

// The "Who sees what" table: a page a role can't see isn't in its nav.
const NAV: Array<[OrgRole, PortalPageId[]]> = [
  ["owner", ["overview", "billing", "members", "engines", "invoices"]],
  ["admin", ["overview", "billing", "members", "engines"]],
  ["member", ["overview", "engines"]],
];

describe("visiblePages", () => {
  for (const [role, pages] of NAV) {
    test(`${role} sees ${pages.join(", ")}`, () => {
      expect(visiblePages(can(role)).map((page) => page.id)).toEqual(pages);
    });
  }
});
