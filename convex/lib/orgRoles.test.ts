import { describe, expect, test } from "bun:test";
import type { OrgRole } from "./organization";
import { type OrgAction, orgCan } from "./orgRoles";

const CASES: Array<[OrgRole | null, OrgAction, boolean]> = [
  ["owner", "viewOrganization", true],
  ["owner", "manageMembers", true],
  ["owner", "createEngine", true],
  ["owner", "manageBilling", true],
  ["owner", "deleteOrganization", true],
  ["admin", "viewOrganization", true],
  ["admin", "manageMembers", true],
  ["admin", "createEngine", true],
  ["admin", "manageBilling", false],
  ["admin", "deleteOrganization", false],
  ["member", "viewOrganization", true],
  ["member", "manageMembers", false],
  ["member", "createEngine", false],
  ["member", "manageBilling", false],
  ["member", "deleteOrganization", false],
  [null, "viewOrganization", false],
  [null, "manageMembers", false],
  [null, "createEngine", false],
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
