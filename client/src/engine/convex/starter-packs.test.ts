import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// Installing catalog content onto the engine: a starter pack's items, and a
// marketplace scene or alert bundle. These check what each install sends and
// that its answer crosses as the gateway's own record.

const calls: Array<{ name: string; args: unknown }> = [];
const answers: Record<string, unknown> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(action);
    calls.push({ name, args });
    return Promise.resolve(answers[name]);
  },
}));

const { convexStarterPacksGateway, toStarterPackInstallOutcome, toStarterPackStatus } = await import("./starter-packs");
const { convexModulesGateway } = await import("./modules");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
});

describe("toStarterPackInstallOutcome", () => {
  const cases: Array<{ name: string; row: Parameters<typeof toStarterPackInstallOutcome>[0]; expected: unknown }> = [
    {
      name: "an installed item",
      row: { itemId: "lurk", outcome: "installed" },
      expected: { itemId: "lurk", outcome: "installed", message: undefined },
    },
    {
      name: "a failed item keeps why",
      row: { itemId: "raid", outcome: "failed", message: "The engine refused the workflow" },
      expected: { itemId: "raid", outcome: "failed", message: "The engine refused the workflow" },
    },
  ];
  for (const { name, row, expected } of cases) {
    test(name, () => {
      expect(toStarterPackInstallOutcome(row)).toEqual(expected);
    });
  }
});

describe("starter pack installs", () => {
  test("installing sends the pack and its values and answers with each item's outcome", async () => {
    answers["starterPacks:install"] = { results: [{ itemId: "lurk", outcome: "pending", message: "Waiting" }] };
    const install = renderInScope(() => convexStarterPacksGateway.useInstallRequest());
    expect(await install({ packId: "handy", values: { cooldown: 30 } })).toEqual([
      { itemId: "lurk", outcome: "pending", message: "Waiting" },
    ]);
    expect(calls).toEqual([
      { name: "starterPacks:install", args: { instanceId, packId: "handy", values: { cooldown: 30 } } },
    ]);
  });
});

describe("marketplace bundle installs", () => {
  test("installing a bundle answers with what it made, without its listing id", async () => {
    answers["marketplaceCatalog:installBundle"] = { listingId: "listing-1", engineId: "scene-9", kind: "scene" };
    const install = renderInScope(() => convexModulesGateway.useBundleInstallRequest());
    expect(await install("listing-1")).toEqual({ kind: "scene", engineId: "scene-9" });
    expect(calls).toEqual([{ name: "marketplaceCatalog:installBundle", args: { instanceId, listingId: "listing-1" } }]);
  });
});

describe("toStarterPackStatus", () => {
  const cases: Array<{ name: string; row: Parameters<typeof toStarterPackStatus>[0]; expected: unknown }> = [
    { name: "no items tracked yet", row: {}, expected: {} },
    {
      name: "each item keeps its key and state",
      row: { "handy:lurk": "installed", "handy:raid": "installing", "raid:shoutout": "conflict" },
      expected: { "handy:lurk": "installed", "handy:raid": "installing", "raid:shoutout": "conflict" },
    },
  ];
  for (const { name, row, expected } of cases) {
    test(name, () => {
      expect(toStarterPackStatus(row)).toEqual(expected);
    });
  }
});
