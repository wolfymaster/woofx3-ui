import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import type { MacroId } from "@/engine/types";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: the macro pad's
// reads and edits must reach the same Convex functions, with the same
// arguments, as the pad called directly.

const calls: Array<{ name: string; args: unknown; optimistic?: boolean }> = [];

const MACRO_ROW = {
  id: "macro-1" as Id<"macros">,
  label: "Hype",
  icon: "Zap",
  color: "#22c55e",
  type: "send-message" as const,
  config: { message: "hype!" },
};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    calls.push({ name: getFunctionName(query), args });
    return [MACRO_ROW];
  },
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve({ triggerId: null });
  },
  useMutation: (mutation: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(mutation);
    const run = (optimistic: boolean) => (args: unknown) => {
      calls.push({ name, args, ...(optimistic ? { optimistic } : {}) });
      return Promise.resolve(name === "macros:addMacro" ? "macro-2" : null);
    };
    return Object.assign(run(false), { withOptimisticUpdate: () => run(true) });
  },
}));

const { convexMacrosGateway } = await import("./macros");

const instanceId = TEST_INSTANCE_ID;
const macroId = "macro-1" as MacroId;
const input = {
  label: "Raid",
  icon: undefined,
  color: undefined,
  type: "chat-command" as const,
  config: { command: "raid" },
};

beforeEach(() => {
  calls.length = 0;
});

describe("macros", () => {
  test("lists the pad as the gateway's macros", () => {
    const macros = renderInScope(() => convexMacrosGateway.useMacros());
    expect(macros).toEqual([{ ...MACRO_ROW, id: "macro-1" as MacroId }]);
    expect(calls).toEqual([{ name: "macros:list", args: { instanceId } }]);
  });

  test("adds a macro and answers with its id", async () => {
    const add = renderInScope(() => convexMacrosGateway.useAddRequest());
    expect(await add(input)).toBe("macro-2" as MacroId);
    expect(calls).toEqual([{ name: "macros:addMacro", args: { instanceId, ...input } }]);
  });

  test("updates and deletes a macro by its id", async () => {
    const update = renderInScope(() => convexMacrosGateway.useUpdateRequest());
    const remove = renderInScope(() => convexMacrosGateway.useDeleteRequest());
    await update(macroId, input);
    await remove(macroId);
    expect(calls).toEqual([
      { name: "macros:updateMacro", args: { instanceId, macroId, ...input } },
      { name: "macros:deleteMacro", args: { instanceId, macroId } },
    ]);
  });

  test("reorders with the optimistic update, so a dragged tile stays put", async () => {
    const reorder = renderInScope(() => convexMacrosGateway.useReorderRequest());
    await reorder(["macro-2" as MacroId, macroId]);
    expect(calls).toEqual([
      { name: "macros:reorderMacros", args: { instanceId, macroIds: ["macro-2", "macro-1"] }, optimistic: true },
    ]);
  });

  test("runs the macro with its variable values", async () => {
    const run = renderInScope(() => convexMacrosGateway.useRunRequest());
    await run(macroId, [{ name: "user", value: "wolfy" }]);
    expect(calls).toEqual([
      { name: "macros:run", args: { instanceId, macroId, values: [{ name: "user", value: "wolfy" }] } },
    ]);
  });
});
