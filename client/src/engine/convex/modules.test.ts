import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
}));

const { convexModulesGateway } = await import("./modules");

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
  result = null;
});

describe("modules.useMarketplaceInstallRequest", () => {
  test("installs the listing with the approved permissions and endpoints", async () => {
    result = { moduleKey: "obs:1.2.0:abcdef1" };
    const install = renderRequest(() => convexModulesGateway.useMarketplaceInstallRequest());
    const answer = await install(instanceId, "listing-1", ["chat:read"], ["obs-websocket"]);
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
    const getDetail = renderRequest(() => convexModulesGateway.useDetailRequest());
    await getDetail(instanceId, "listing-1");
    expect(calls).toEqual([{ name: "moduleDetail:getModuleDetail", args: { instanceId, moduleId: "listing-1" } }]);
  });
});
