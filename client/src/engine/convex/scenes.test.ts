import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { NoInstanceSelectedError } from "@/engine/scope";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: a scene request
// names only the scene, and the adapter fills in the scope's instance.

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

const { convexScenesGateway } = await import("./scenes");

beforeEach(() => {
  calls.length = 0;
  result = null;
});

describe("scenes.useRepairRequest", () => {
  test("repairs the scene on the scope's instance and answers with the engine's result", async () => {
    result = { ok: true, backups: 2 };
    const repair = renderInScope(() => convexScenesGateway.useRepairRequest());
    const answer = await repair("scene-1");
    expect(calls).toEqual([
      { name: "sceneActions:repairScene", args: { instanceId: TEST_INSTANCE_ID, engineSceneId: "scene-1" } },
    ]);
    expect(answer).toEqual({ ok: true, backups: 2 });
  });

  test("rejects without asking while no instance is selected", async () => {
    const repair = renderInScope(() => convexScenesGateway.useRepairRequest(), null);
    await expect(repair("scene-1")).rejects.toBeInstanceOf(NoInstanceSelectedError);
    expect(calls).toEqual([]);
  });
});
