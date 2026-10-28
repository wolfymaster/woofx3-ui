import { describe, expect, test } from "bun:test";
import type { CommandSnapshot } from "@woofx3/api";
import type { NewChatCommand } from "@/engine/types";
import { normalizeUsername, toChatCommand, toCommandInput } from "./commands";

const snapshot: CommandSnapshot = {
  id: "command-1",
  command: "hug",
  actions: [],
  workflowId: "workflow-1",
  steps: [{ id: "t1", type: "action", parameters: { $ref: "x" } } as unknown as CommandSnapshot["steps"][number]],
  workflowError: "",
  cooldown: 5,
  priority: 1,
  enabled: true,
  visibility: "public",
  groupIds: [],
  usernames: [],
  argumentPattern: "{target}",
};

const base: NewChatCommand = { command: "hug", enabled: true, cooldown: 0, visibility: "public" };

describe("toChatCommand", () => {
  test("escapes the `$` keys of its steps and actions", () => {
    expect(toChatCommand(snapshot).steps).toEqual([{ id: "t1", type: "action", parameters: { __$ref: "x" } }]);
  });

  test("reads an empty workflow id and error as absent", () => {
    const command = toChatCommand({ ...snapshot, workflowId: "", workflowError: "" });
    expect([command.engineWorkflowId, command.workflowError]).toEqual([undefined, undefined]);
  });
});

describe("toCommandInput", () => {
  test("unescapes `$` keys on the way out", () => {
    const input = toCommandInput({ ...base, steps: [{ parameters: { __$ref: "x" } }] });
    expect(input.steps).toEqual([{ parameters: { $ref: "x" } }] as unknown as typeof input.steps);
  });

  test.each([
    ["steps win over actions", { steps: [], actions: [{ a: 1 }] }, { steps: [] }],
    ["actions alone are sent as actions", { actions: [{ a: 1 }] }, { actions: [{ a: 1 }] }],
    ["neither sends neither", {}, {}],
  ] as const)("%s", (_case, parts, expected) => {
    const input = toCommandInput({ ...base, ...parts });
    expect({ steps: input.steps, actions: input.actions }).toEqual({
      steps: undefined,
      actions: undefined,
      ...expected,
    } as never);
  });
});

describe("normalizeUsername", () => {
  test("trims and lowercases, as the engine stores names", () => {
    expect(normalizeUsername("  Wolfy ")).toBe("wolfy");
  });
});
