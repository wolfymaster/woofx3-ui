import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: the marketplace
// install hook and listing page reach these through the gateway, and must
// send what they sent when they called Convex themselves.

const calls: Array<{ name: string; args: unknown }> = [];
let result: unknown = null;
/** What an action answers by its function name, where a test needs more than `result`. */
let answers: Record<string, unknown> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(action);
    calls.push({ name, args });
    return Promise.resolve(name in answers ? answers[name] : result);
  },
}));

const { convexModulesGateway } = await import("./modules");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
  result = null;
  answers = {};
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
    manifestId: "obs",
    version: "1.2.0",
    approvedPermissions: ["obs.control"],
    approvedLocalEndpoints: ["obs-websocket"],
  };
  const approvals = { approvedPermissions: ["obs.control"], approvedLocalEndpoints: ["obs-websocket"] };
  const grant = {
    resource: { id: "res-1" },
    uploadUrl: "https://storage.test/put",
    method: "PUT",
    headers: [
      { name: "Content-Type", value: "application/zip" },
      { name: "Content-Length", value: "4" },
    ],
  };
  const realFetch = globalThis.fetch;
  const puts: Array<{ url: string; init: RequestInit | undefined }> = [];

  function answerPutsWith(response: Response) {
    puts.length = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      puts.push({ url, init });
      return Promise.resolve(response);
    }) as typeof fetch;
  }

  async function storedName(): Promise<string> {
    const { moduleArchiveFileName } = await import("@/lib/module-archive");
    return moduleArchiveFileName("obs", "1.2.0", archive);
  }

  test("stores the archive as a custom module, then has the engine install it with the approvals", async () => {
    answers = {
      "resources:list": { resources: [], total: 0, page: 1, pageSize: 10 },
      "resources:requestUpload": grant,
      "resources:completeUpload": { id: "res-1" },
      "moduleEngine:installFromResource": { moduleKey: "obs:1.2.0:abcdef1" },
    };
    answerPutsWith(new Response(null, { status: 200 }));
    try {
      const installArchive = renderInScope(() => convexModulesGateway.useArchiveInstallRequest());
      expect(await installArchive(install)).toEqual({ moduleKey: "obs:1.2.0:abcdef1" });
    } finally {
      globalThis.fetch = realFetch;
    }
    const name = await storedName();
    expect(name).toMatch(/^obs-1\.2\.0-[0-9a-f]{7}\.zip$/);
    expect(puts.map(({ url, init }) => ({ url, method: init?.method }))).toEqual([
      { url: "https://storage.test/put", method: "PUT" },
    ]);
    expect(new Headers(puts[0].init?.headers).has("content-length")).toBe(false);
    expect(calls).toEqual([
      {
        name: "resources:list",
        args: { instanceId, folderId: null, kind: "custom_module", search: name, pageSize: 10 },
      },
      {
        name: "resources:requestUpload",
        args: { instanceId, name, contentType: "application/zip", parentId: null, size: 4, kind: "custom_module" },
      },
      { name: "resources:completeUpload", args: { instanceId, resourceId: "res-1" } },
      { name: "moduleEngine:installFromResource", args: { instanceId, resourceId: "res-1", ...approvals } },
    ]);
  });

  test("installs the same build again from storage rather than storing it twice", async () => {
    const name = await storedName();
    answers = {
      "resources:list": { resources: [{ id: "res-0", name, status: "ready" }], total: 1, page: 1, pageSize: 10 },
      "moduleEngine:installFromResource": { moduleKey: "obs:1.2.0:abcdef1" },
    };
    const installArchive = renderInScope(() => convexModulesGateway.useArchiveInstallRequest());
    expect(await installArchive(install)).toEqual({ moduleKey: "obs:1.2.0:abcdef1" });
    expect(calls.map((call) => call.name)).toEqual(["resources:list", "moduleEngine:installFromResource"]);
    expect(calls[1].args).toEqual({ instanceId, resourceId: "res-0", ...approvals });
  });

  test("a refused upload frees its reservation and reaches no install", async () => {
    answers = {
      "resources:list": { resources: [], total: 0, page: 1, pageSize: 10 },
      "resources:requestUpload": grant,
    };
    answerPutsWith(new Response("no", { status: 500 }));
    try {
      const installArchive = renderInScope(() => convexModulesGateway.useArchiveInstallRequest());
      const failure = await installArchive(install).catch((error: Error) => error);
      expect(String(failure)).toContain("upload failed (500)");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls.map((call) => call.name)).toEqual(["resources:list", "resources:requestUpload", "resources:remove"]);
  });
});
