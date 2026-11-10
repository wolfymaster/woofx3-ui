import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { InstanceRole } from "@convex/lib/instanceRoles";
import { act, create } from "react-test-renderer";

let role: InstanceRole | null | undefined;
const lookups: string[] = [];

const realRole = await import("@/engine/hooks/use-viewer-role");
mock.module("@/engine/hooks/use-viewer-role", () => ({ ...realRole, useViewerRole: () => role }));
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
    test(`a ${allowed} gets the key, masked, with show and copy controls`, async () => {
      role = allowed;
      const html = await render();
      expect(lookups).toEqual(["listing-1"]);
      expect(html).toContain("module-license-key");
      expect(html).toContain("Copy");
      expect(html).not.toContain("W3X-SECRET-KEY");
    });
  }

  for (const denied of ["member", null, undefined] as const) {
    test(`${String(denied)} sees nothing and the key is never fetched`, async () => {
      role = denied;
      expect(await render()).toBe("null");
      expect(lookups).toEqual([]);
    });
  }
});
