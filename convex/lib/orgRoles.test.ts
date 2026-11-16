import { describe, expect, test } from "bun:test";
import type { OrgRole } from "./organization";
import { type OrgAction, orgCan } from "./orgRoles";

const CASES: Array<[OrgRole | null, OrgAction, boolean]> = [
  ["owner", "viewOrganization", true],
  ["owner", "renameOrganization", true],
  ["owner", "manageMembers", true],
  ["owner", "viewMemberEmails", true],
  ["owner", "renameEngine", true],
  ["owner", "manageEngines", true],
  ["owner", "createEngine", true],
  ["owner", "changeEngineUrl", true],
  ["owner", "viewBilling", true],
  ["owner", "manageBilling", true],
  ["admin", "viewOrganization", true],
  ["admin", "renameOrganization", false],
  ["admin", "manageMembers", true],
  ["admin", "viewMemberEmails", false],
  ["admin", "renameEngine", false],
  ["admin", "manageEngines", true],
  ["admin", "createEngine", false],
  ["admin", "changeEngineUrl", false],
  ["admin", "viewBilling", true],
  ["admin", "manageBilling", false],
  ["member", "viewOrganization", true],
  ["member", "renameOrganization", false],
  ["member", "manageMembers", false],
  ["member", "viewMemberEmails", false],
  ["member", "renameEngine", false],
  ["member", "manageEngines", false],
  ["member", "createEngine", false],
  ["member", "changeEngineUrl", false],
  ["member", "viewBilling", false],
  ["member", "manageBilling", false],
  [null, "viewOrganization", false],
  [null, "renameOrganization", false],
  [null, "manageMembers", false],
  [null, "viewMemberEmails", false],
  [null, "renameEngine", false],
  [null, "manageEngines", false],
  [null, "createEngine", false],
  [null, "changeEngineUrl", false],
  [null, "viewBilling", false],
  [null, "manageBilling", false],
];

describe("orgCan", () => {
  for (const [role, action, allowed] of CASES) {
    test(`${role ?? "non-member"} ${allowed ? "may" : "may not"} ${action}`, () => {
      expect(orgCan(role, action)).toBe(allowed);
    });
  }
});
