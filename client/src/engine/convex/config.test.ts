import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

function renderRequest<T>(hook: () => T): T {
  let value: T | undefined;
  function Probe() {
    value = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (value === undefined) {
    throw new Error("the probe did not render");
  }
  return value;
}

const instanceId = "instance-1" as Id<"instances">;

beforeEach(() => {
  calls.length = 0;
});

describe("config backup requests", () => {
  test("export the chosen sections", async () => {
    const exportConfig = renderRequest(() => convexConfigGateway.useExportRequest());
    await exportConfig(instanceId, { include: ["workflows", "commands"], includeMembers: false });
    expect(calls).toEqual([
      {
        name: "configBackup:exportConfig",
        args: { instanceId, include: ["workflows", "commands"], includeMembers: false },
      },
    ]);
  });

  test("preview and import send the same backup and options", async () => {
    const preview = renderRequest(() => convexConfigGateway.usePreviewImportRequest());
    const importConfig = renderRequest(() => convexConfigGateway.useImportRequest());
    const request = {
      bundleChunks: ["{", "}"],
      onConflict: "rename" as const,
      include: ["resources" as const],
      applyMembers: true,
    };
    await preview(instanceId, request);
    await importConfig(instanceId, request);
    expect(calls).toEqual([
      { name: "configBackup:previewImport", args: { instanceId, ...request } },
      { name: "configBackup:importConfig", args: { instanceId, ...request } },
    ]);
  });
});

describe("config storage requests", () => {
  test("read and replace the storage backend", async () => {
    const getConfig = renderRequest(() => convexConfigGateway.useStorageConfigRequest());
    const setConfig = renderRequest(() => convexConfigGateway.useSetStorageConfigRequest());
    await getConfig(instanceId);
    await setConfig(instanceId, { provider: "file" });
    expect(calls).toEqual([
      { name: "storage:getConfig", args: { instanceId } },
      { name: "storage:setConfig", args: { instanceId, config: { provider: "file" } } },
    ]);
  });
});
