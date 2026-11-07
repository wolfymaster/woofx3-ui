import { describe, expect, test } from "bun:test";
import type { OrgRole } from "./organization";
import { type OrgAction, orgCan } from "./orgRoles";

const CASES: Array<[OrgRole | null, OrgAction, boolean]> = [
  ["owner", "viewOrganization", true],
  ["owner", "renameOrganization", true],
  ["owner", "manageMembers", true],
  ["owner", "createEngine", true],
  ["owner", "viewBilling", true],
  ["owner", "manageBilling", true],
  ["owner", "deleteOrganization", true],
  ["admin", "viewOrganization", true],
  ["admin", "renameOrganization", true],
  ["admin", "manageMembers", true],
  ["admin", "createEngine", true],
  ["admin", "viewBilling", true],
  ["admin", "manageBilling", false],
  ["admin", "deleteOrganization", false],
  ["member", "viewOrganization", true],
  ["member", "renameOrganization", false],
  ["member", "manageMembers", false],
  ["member", "createEngine", false],
  ["member", "viewBilling", false],
  ["member", "manageBilling", false],
  ["member", "deleteOrganization", false],
  [null, "viewOrganization", false],
  [null, "renameOrganization", false],
  [null, "manageMembers", false],
  [null, "createEngine", false],
  [null, "viewBilling", false],
  [null, "manageBilling", false],
  [null, "deleteOrganization", false],
];

describe("orgCan", () => {
  for (const [role, action, allowed] of CASES) {
    test(`${role ?? "non-member"} ${allowed ? "may" : "may not"} ${action}`, () => {
      expect(orgCan(role, action)).toBe(allowed);
    });
  }
});
