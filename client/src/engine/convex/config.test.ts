import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: a gateway
// request must send what the Backup page and the storage settings sent
// before.

const calls: Array<{ name: string; args: unknown }> = [];

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve(null);
  },
}));

const { convexConfigGateway } = await import("./config");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
});

describe("config backup requests", () => {
  test("export the chosen sections", async () => {
    const exportConfig = renderInScope(() => convexConfigGateway.useExportRequest());
    await exportConfig({ include: ["workflows", "commands"], includeMembers: false });
    expect(calls).toEqual([
      {
        name: "configBackup:exportConfig",
        args: { instanceId, include: ["workflows", "commands"], includeMembers: false },
      },
    ]);
  });

  test("preview and import send the same backup and options", async () => {
    const preview = renderInScope(() => convexConfigGateway.usePreviewImportRequest());
    const importConfig = renderInScope(() => convexConfigGateway.useImportRequest());
    const request = {
      bundleChunks: ["{", "}"],
      onConflict: "rename" as const,
      include: ["resources" as const],
      applyMembers: true,
    };
    await preview(request);
    await importConfig(request);
    expect(calls).toEqual([
      { name: "configBackup:previewImport", args: { instanceId, ...request } },
      { name: "configBackup:importConfig", args: { instanceId, ...request } },
    ]);
  });
});

describe("config storage requests", () => {
  test("read and replace the storage backend", async () => {
    const getConfig = renderInScope(() => convexConfigGateway.useStorageConfigRequest());
    const setConfig = renderInScope(() => convexConfigGateway.useSetStorageConfigRequest());
    await getConfig();
    await setConfig({ provider: "file" });
    expect(calls).toEqual([
      { name: "storage:getConfig", args: { instanceId } },
      { name: "storage:setConfig", args: { instanceId, config: { provider: "file" } } },
    ]);
  });
});
