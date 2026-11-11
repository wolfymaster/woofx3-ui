import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OrgRole } from "@convex/lib/organization";
import { orgCan } from "@convex/lib/orgRoles";
import { act, create } from "react-test-renderer";
import type { OrganizationAccess } from "@/engine/types";

let access: OrganizationAccess | null | undefined;
const accessOf = (role: OrgRole): OrganizationAccess => ({
  viewBilling: orgCan(role, "viewBilling"),
  manageBilling: orgCan(role, "manageBilling"),
});
const lookups: string[] = [];

const realAccess = await import("@/engine/hooks/use-organization-access");
mock.module("@/engine/hooks/use-organization-access", () => ({ ...realAccess, useOrganizationAccess: () => access }));
// Stable across renders, like the real hook's callback: the component refetches when it changes.
const getLicenseKey = async ({ listingId }: { listingId: string }) => {
  lookups.push(listingId);
  return "W3X-SECRET-KEY";
};
// mock.module is process-wide, so the other exports stay real for the test files that share it.
const realModules = await import("@/engine/hooks/use-modules");
mock.module("@/engine/hooks/use-modules", () => ({ ...realModules, useModuleLicenseKeyRequest: () => getLicenseKey }));
const logger = { warn: () => undefined };
const realLogger = await import("@/lib/logger-context");
mock.module("@/lib/logger-context", () => ({ ...realLogger, useLogger: () => logger }));

const { ModuleLicenseKey } = await import("./module-license-key");

async function render(): Promise<string> {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ModuleLicenseKey moduleId="m" listingId="listing-1" />);
  });
  return JSON.stringify(tree.toJSON());
}

describe("ModuleLicenseKey", () => {
  beforeEach(() => {
    lookups.length = 0;
  });

  for (const allowed of ["owner", "admin"] as const) {
    test(`an organization ${allowed} gets the key, masked, with show and copy controls`, async () => {
      access = accessOf(allowed);
      const html = await render();
      expect(lookups).toEqual(["listing-1"]);
      expect(html).toContain("module-license-key");
      expect(html).toContain("Copy");
      expect(html).not.toContain("W3X-SECRET-KEY");
    });
  }

  for (const denied of [accessOf("member"), null, undefined]) {
    test(`${JSON.stringify(denied)} sees nothing and the key is never fetched`, async () => {
      access = denied;
      expect(await render()).toBe("null");
      expect(lookups).toEqual([]);
    });
  }
});
