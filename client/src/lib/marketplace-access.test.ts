import { describe, expect, test } from "bun:test";
import type { OrgRole } from "@convex/lib/organization";
import { orgCan } from "@convex/lib/orgRoles";
import type { OrganizationAccess } from "@/engine/types";
import { canSeeLicenseKey, canStartPayment } from "./marketplace-access";

/** The access the server answers for each organization role. */
function accessOf(role: OrgRole): OrganizationAccess {
  return { viewBilling: orgCan(role, "viewBilling"), manageBilling: orgCan(role, "manageBilling") };
}

describe("canStartPayment", () => {
  test.each([
    ["owner", true],
    ["admin", false],
    ["member", false],
  ] as const)("an organization %s may start a payment: %p", (role, allowed) => {
    expect(canStartPayment(accessOf(role))).toBe(allowed);
  });

  test.each([null, undefined])("%p access may not start a payment", (access) => {
    expect(canStartPayment(access)).toBe(false);
  });
});

describe("canSeeLicenseKey", () => {
  test.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("an organization %s may see a license key: %p", (role, allowed) => {
    expect(canSeeLicenseKey(accessOf(role))).toBe(allowed);
  });

  test.each([null, undefined])("%p access may not see a license key", (access) => {
    expect(canSeeLicenseKey(access)).toBe(false);
  });
});
