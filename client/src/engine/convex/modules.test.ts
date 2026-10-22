import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: the marketplace
// install hook and listing page reach these through the gateway, and must
// send what they sent when they called Convex themselves.

const calls: Array<{ name: string; args: unknown }> = [];
let result: unknown = null;

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve(result);
  },
  useMutation: (mutation: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(mutation);
    calls.push({ name, args });
    return Promise.resolve(name === "moduleRepository:generateUploadUrl" ? UPLOAD_URL : { delivered: true });
  },
}));

const UPLOAD_URL = "https://storage.test/upload";

const { convexModulesGateway } = await import("./modules");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
  result = null;
});

describe("modules.useMarketplaceInstallRequest", () => {
  test("installs the listing with the approved permissions and endpoints", async () => {
    result = { moduleKey: "obs:1.2.0:abcdef1" };
    const install = renderInScope(() => convexModulesGateway.useMarketplaceInstallRequest());
    const answer = await install("listing-1", ["chat:read"], ["obs-websocket"]);
    expect(calls).toEqual([
      {
        name: "marketplace:installModule",
        args: {
          instanceId,
          marketplaceModuleId: "listing-1",
          approvedPermissions: ["chat:read"],
          approvedLocalEndpoints: ["obs-websocket"],
        },
      },
    ]);
    expect(answer).toEqual({ moduleKey: "obs:1.2.0:abcdef1" });
  });
});

describe("modules.useDetailRequest", () => {
  test("asks for the detail of a marketplace id", async () => {
    result = { id: "listing-1", name: "OBS" };
    const getDetail = renderInScope(() => convexModulesGateway.useDetailRequest());
    const detail = await getDetail("listing-1");
    expect(calls).toEqual([{ name: "moduleDetail:getModuleDetail", args: { instanceId, moduleId: "listing-1" } }]);
    expect(detail).toEqual({ id: "listing-1", name: "OBS" } as unknown as typeof detail);
  });

  test("passes an installed module's id through", async () => {
    result = { id: "obs", moduleDbId: "module-row-1" };
    const getDetail = renderInScope(() => convexModulesGateway.useDetailRequest());
    const detail = await getDetail("obs");
    expect(detail.moduleDbId).toBe("module-row-1" as typeof detail.moduleDbId);
  });
});

describe("modules.useStorageUsageRequest", () => {
  test("asks about the scope's instance and maps the usage field by field", async () => {
    result = { usedBytes: 600, limitBytes: 500, over: true, internalNote: "cloud only" };
    const readUsage = renderInScope(() => convexModulesGateway.useStorageUsageRequest());
    const usage = await readUsage();
    expect(calls).toEqual([{ name: "moduleStorage:usage", args: { instanceId } }]);
    expect(usage).toEqual({ usedBytes: 600, limitBytes: 500, over: true });
  });

  test("passes no limit through as null", async () => {
    result = null;
    const readUsage = renderInScope(() => convexModulesGateway.useStorageUsageRequest());
    expect(await readUsage()).toBeNull();
  });
});

describe("modules.useArchiveInstallRequest", () => {
  const archive = new Uint8Array([80, 75, 3, 4]);
  const install = {
    archive,
    moduleKey: "obs:1.2.0:abcdef1",
    name: "OBS",
    description: "Scenes",
    version: "1.2.0",
    tags: ["obs"],
    manifest: { id: "obs" },
  };
  const realFetch = globalThis.fetch;
  const uploads: Array<{ url: string; init: RequestInit | undefined }> = [];

  function answerUploadsWith(response: Response) {
    uploads.length = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      uploads.push({ url, init });
      return Promise.resolve(response);
    }) as typeof fetch;
  }

  test("stores the archive, then hands its storage key to the engine delivery", async () => {
    answerUploadsWith(Response.json({ storageId: "storage-1" }));
    try {
      const installArchive = renderInScope(() => convexModulesGateway.useArchiveInstallRequest());
      expect(await installArchive(install)).toEqual({ moduleKey: "obs:1.2.0:abcdef1" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(uploads.map(({ url, init }) => ({ url, method: init?.method }))).toEqual([
      { url: UPLOAD_URL, method: "POST" },
    ]);
    expect(calls).toEqual([
      { name: "moduleRepository:generateUploadUrl", args: undefined },
      {
        name: "moduleRepository:uploadAndDeliver",
        args: {
          instanceId,
          moduleKey: "obs:1.2.0:abcdef1",
          name: "OBS",
          description: "Scenes",
          version: "1.2.0",
          tags: ["obs"],
          manifest: { id: "obs" },
          archiveKey: "storage-1",
        },
      },
    ]);
  });

  test("a refused upload rejects before anything reaches the engine", async () => {
    answerUploadsWith(new Response("no", { status: 500 }));
    try {
      const installArchive = renderInScope(() => convexModulesGateway.useArchiveInstallRequest());
      await expect(installArchive(install)).rejects.toThrow("Upload failed");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls.map((call) => call.name)).toEqual(["moduleRepository:generateUploadUrl"]);
  });
});
