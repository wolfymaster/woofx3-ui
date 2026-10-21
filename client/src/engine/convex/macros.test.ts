import { describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so the call can be checked: running a macro
// through the gateway must send what the macro pad and the command palette
// sent before.

const calls: Array<{ name: string; args: unknown }> = [];

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve({ triggerId: null });
  },
}));

const { convexMacrosGateway } = await import("./macros");

const instanceId = TEST_INSTANCE_ID;
const macroId = "macro-1" as Id<"macros">;

describe("macros.useRunRequest", () => {
  test("runs the macro with its variable values", async () => {
    const run = renderInScope(() => convexMacrosGateway.useRunRequest());
    await run(macroId, [{ name: "user", value: "wolfy" }]);
    expect(calls).toEqual([
      { name: "macros:run", args: { instanceId, macroId, values: [{ name: "user", value: "wolfy" }] } },
    ]);
  });
});
