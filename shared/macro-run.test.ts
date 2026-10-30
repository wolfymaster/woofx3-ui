import { describe, expect, test } from "bun:test";
import {
  chatCommandFromConfig,
  hasControlCharacter,
  macroActionToEngineStep,
  macroCommandRefusal,
  macroRunActionsInput,
  missingMacroVariables,
  type PlanResult,
  parseChatCommand,
  planMacroRun,
} from "./macro-run";
import type { MacroActionType, MacroConfig } from "./macro-variables";

describe("parseChatCommand", () => {
  const cases: Array<{ name: string; line: string; expected: ReturnType<typeof parseChatCommand> }> = [
    { name: "a command with text", line: "!so bob", expected: { commandName: "so", text: "bob" } },
    { name: "surrounding space", line: "  !hype  ", expected: { commandName: "hype", text: "" } },
    { name: "inner spacing kept", line: "!raid a b  c", expected: { commandName: "raid", text: "a b  c" } },
    { name: "a plain message", line: "hello chat", expected: null },
    { name: "a bare !", line: "!", expected: null },
    { name: "a space after !", line: "! so", expected: null },
    { name: "nothing", line: "", expected: null },
  ];
  for (const { name, line, expected } of cases) {
    test(name, () => {
      expect(parseChatCommand(line)).toEqual(expected);
    });
  }
});

describe("chatCommandFromConfig", () => {
  const cases: Array<{ name: string; config: MacroConfig; expected: ReturnType<typeof chatCommandFromConfig> }> = [
    {
      name: "a picked word and its text",
      config: { command: "so", commandText: " bob " },
      expected: { commandName: "so", text: "bob" },
    },
    {
      name: "a picked word typed with its !",
      config: { command: "!so", commandText: "" },
      expected: { commandName: "so", text: "" },
    },
    { name: "an older typed line", config: { command: "!so bob" }, expected: { commandName: "so", text: "bob" } },
    { name: "an older line without !", config: { command: "so bob" }, expected: null },
    { name: "a picked word that is two words", config: { command: "so bob", commandText: "" }, expected: null },
    { name: "an empty pick", config: { command: "", commandText: "" }, expected: null },
  ];
  for (const { name, config, expected } of cases) {
    test(name, () => {
      expect(chatCommandFromConfig(config)).toEqual(expected);
    });
  }
});

describe("missingMacroVariables", () => {
  const cases: Array<{ name: string; config: MacroConfig; values: Record<string, string>; expected: string[] }> = [
    {
      name: "absent and blank values, in authored order",
      config: { command: "!so {{channel}} {{reason}}" },
      values: { reason: "  " },
      expected: ["channel", "reason"],
    },
    { name: "every value given", config: { command: "!so {{channel}}" }, values: { channel: "bob" }, expected: [] },
  ];
  for (const { name, config, values, expected } of cases) {
    test(name, () => {
      expect(missingMacroVariables(config, values)).toEqual(expected);
    });
  }
});

describe("hasControlCharacter", () => {
  const cases: Array<{ value: string; expected: boolean }> = [
    { value: "a\nb", expected: true },
    { value: "a\u0000", expected: true },
    { value: "a\u007f", expected: true },
    { value: "bob ross é 🙂", expected: false },
  ];
  for (const { value, expected } of cases) {
    test(JSON.stringify(value), () => {
      expect(hasControlCharacter(value)).toBe(expected);
    });
  }
});

describe("planMacroRun", () => {
  const cases: Array<{
    name: string;
    type: MacroActionType;
    config: MacroConfig;
    values?: Record<string, string>;
    expected: PlanResult | { ok: false; status: 400 | 422 };
  }> = [
    {
      name: "refuses a control character in a used variable",
      type: "chat-command",
      config: { command: "!so {{channel}}" },
      values: { channel: "bob\r\n!ban x" },
      expected: { ok: false, status: 400, error: "control characters are not allowed in: channel" },
    },
    {
      name: "plans a workflow run",
      type: "trigger-workflow",
      config: { workflowId: "wf-1" },
      expected: { ok: true, plan: { kind: "trigger-workflow", workflowNameOrId: "wf-1" } },
    },
    {
      name: "refuses a workflow macro with nothing selected",
      type: "trigger-workflow",
      config: {},
      expected: { ok: false, status: 422 },
    },
    {
      name: "plans an action with variables filled in through nested settings",
      type: "run-action",
      config: {
        actionStep: {
          action: "function",
          function: "obs.setScene",
          ref: "obs:action:setScene",
          parameters: { scene: "{{scene}}", options: { tags: ["{{scene}}-live"] }, delay: 3 },
        },
      },
      values: { scene: "Gaming" },
      expected: {
        ok: true,
        plan: {
          kind: "run-action",
          step: {
            action: "function",
            function: "obs.setScene",
            ref: "obs:action:setScene",
            parameters: { scene: "Gaming", options: { tags: ["Gaming-live"] }, delay: 3 },
          },
        },
      },
    },
    {
      name: "asks for an action's variables before running it",
      type: "run-action",
      config: { actionStep: { action: "print", parameters: { text: "hi {{name}}" } } },
      expected: { ok: false, status: 400 },
    },
    {
      name: "refuses an action macro with nothing selected",
      type: "run-action",
      config: {},
      expected: { ok: false, status: 422 },
    },
    {
      name: "plans a chat command with its variables filled in",
      type: "chat-command",
      config: { command: "!so {{channel}}" },
      values: { channel: "bob" },
      expected: { ok: true, plan: { kind: "chat-command", commandName: "so", text: "bob" } },
    },
    {
      name: "names every missing variable",
      type: "chat-command",
      config: { command: "!so {{channel}} {{reason}}" },
      expected: { ok: false, status: 400, error: "missing variables: channel, reason" },
    },
    {
      name: "refuses a chat command that is not a !command",
      type: "chat-command",
      config: { command: "hello chat" },
      expected: { ok: false, status: 422 },
    },
    {
      name: "plans a picked command word with its arguments in commandText",
      type: "chat-command",
      config: { command: "so", commandText: " {{channel}} " },
      values: { channel: "bob" },
      expected: { ok: true, plan: { kind: "chat-command", commandName: "so", text: "bob" } },
    },
    {
      name: "refuses an empty picked command",
      type: "chat-command",
      config: { command: "", commandText: "" },
      expected: { ok: false, status: 422 },
    },
    {
      name: "refuses a picked command of more than one word",
      type: "chat-command",
      config: { command: "so bob", commandText: "" },
      expected: { ok: false, status: 422 },
    },
    {
      name: "refuses send-message macros",
      type: "send-message",
      config: { message: "hi" },
      expected: { ok: false, status: 422 },
    },
    {
      name: "refuses HTTP request macros before looking at their variables",
      type: "http-request",
      config: { url: "https://example.com/{{x}}", headers: { a: "secret" } },
      expected: { ok: false, status: 422 },
    },
  ];
  for (const { name, type, config, values, expected } of cases) {
    test(name, () => {
      const result = planMacroRun(type, config, values ?? {});
      expect(result).toMatchObject(expected);
      if (!result.ok) {
        expect(result.error).not.toContain("secret");
      }
    });
  }
});

describe("macroActionToEngineStep", () => {
  test("restores the catalog ref and escaped setting keys for the engine", () => {
    expect(
      macroActionToEngineStep({
        action: "function",
        function: "obs.setScene",
        ref: "obs:action:setScene",
        parameters: { layout: { __$schema: "v1" } },
      })
    ).toEqual({
      action: "function",
      function: "obs.setScene",
      $ref: "obs:action:setScene",
      parameters: { layout: { $schema: "v1" } },
    });
  });

  test("leaves out what the stored step does not name", () => {
    expect(macroActionToEngineStep({ action: "print" })).toEqual({ action: "print", parameters: {} });
  });
});

describe("macroRunActionsInput", () => {
  test("runs the one step, labelled and sourced by who pressed it", () => {
    expect(macroRunActionsInput({ action: "function", ref: "obs:action:setScene" }, "dashboard")).toEqual({
      label: "macro:dashboard",
      actions: [{ action: "function", $ref: "obs:action:setScene", parameters: {} }],
      event: { type: "macro.run", source: "dashboard", data: {} },
    });
  });
});

describe("macroCommandRefusal", () => {
  const cases: Array<{ name: string; message: string; expected: string }> = [
    { name: "the engine's reason", message: "Command is disabled", expected: "Command is disabled" },
    { name: "a refusal with no reason", message: "", expected: 'the engine refused "!so"' },
  ];
  for (const { name, message, expected } of cases) {
    test(name, () => {
      expect(macroCommandRefusal("so", message)).toBe(expected);
    });
  }
});
