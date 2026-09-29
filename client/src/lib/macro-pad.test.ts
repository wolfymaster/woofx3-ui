import { describe, expect, test } from "bun:test";
import {
  applyMacroVariables,
  chatCommandParts,
  extractMacroVariables,
  hasMacroVariables,
  isHexColor,
  MACRO_COLOR_PRESETS,
  type MacroConfig,
} from "./macro-pad";

// The workflow engine's own dollar-brace syntax, written out literally because
// surviving macro-variable handling untouched is exactly what is under test.
// biome-ignore lint/suspicious/noTemplateCurlyInString: a literal engine expression, not a mis-typed template string
const ENGINE_EXPRESSION = "${trigger.data.userName}";

describe("extractMacroVariables", () => {
  test("finds a variable in a chat command", () => {
    expect(extractMacroVariables({ command: "!so {{channel}}" })).toEqual(["channel"]);
  });

  test("tolerates padding inside the braces", () => {
    expect(extractMacroVariables({ command: "!so {{ channel }}" })).toEqual(["channel"]);
  });

  test("returns names in first-appearance order across fields", () => {
    const config: MacroConfig = {
      url: "https://example.com/{{target}}",
      body: '{"who":"{{name}}","again":"{{target}}"}',
    };
    expect(extractMacroVariables(config)).toEqual(["target", "name"]);
  });

  test("deduplicates a name used more than once", () => {
    expect(extractMacroVariables({ command: "{{user}} and {{user}}" })).toEqual(["user"]);
  });

  test("scans header values", () => {
    expect(extractMacroVariables({ headers: { Authorization: "Bearer {{token}}" } })).toEqual(["token"]);
  });

  test("ignores the workflow engine's dollar-brace syntax", () => {
    expect(extractMacroVariables({ command: `!hi ${ENGINE_EXPRESSION}` })).toEqual([]);
  });

  test("ignores the shared resolver's single-brace syntax", () => {
    expect(extractMacroVariables({ command: "!hi {userName}" })).toEqual([]);
  });

  test("ignores a name with characters outside the allowed set", () => {
    expect(extractMacroVariables({ command: "{{not-allowed}} {{$nope}}" })).toEqual([]);
  });

  test("does not scan picker-backed fields", () => {
    expect(extractMacroVariables({ workflowId: "{{wf}}", method: "GET" })).toEqual([]);
  });

  test("returns nothing for a macro with no variables", () => {
    expect(extractMacroVariables({ command: "!lurk" })).toEqual([]);
  });
});

describe("isHexColor", () => {
  test("accepts six-digit hex in either case", () => {
    expect(isHexColor("#3b82f6")).toBe(true);
    expect(isHexColor("#3B82F6")).toBe(true);
  });

  test("rejects the three-digit shorthand, which the alpha suffix would break", () => {
    expect(isHexColor("#abc")).toBe(false);
  });

  test("rejects a value with an alpha pair already applied", () => {
    expect(isHexColor("#3b82f620")).toBe(false);
  });

  test("rejects named colors and other css color syntax", () => {
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("rgb(1,2,3)")).toBe(false);
    expect(isHexColor("transparent")).toBe(false);
  });

  test("rejects a missing hash and non-hex characters", () => {
    expect(isHexColor("3b82f6")).toBe(false);
    expect(isHexColor("#gggggg")).toBe(false);
  });

  test("rejects undefined and empty", () => {
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor("")).toBe(false);
  });

  test("every shipped preset is a valid stored value", () => {
    for (const preset of MACRO_COLOR_PRESETS) {
      expect(isHexColor(preset.value)).toBe(true);
    }
  });
});

describe("hasMacroVariables", () => {
  test("is true only when a variable is present", () => {
    expect(hasMacroVariables({ command: "!so {{channel}}" })).toBe(true);
    expect(hasMacroVariables({ command: "!lurk" })).toBe(false);
  });
});

describe("applyMacroVariables", () => {
  test("substitutes into a chat command", () => {
    const result = applyMacroVariables({ command: "!so {{channel}}" }, { channel: "wolfymaster" });
    expect(result.command).toBe("!so wolfymaster");
  });

  test("substitutes every occurrence of a repeated name", () => {
    const result = applyMacroVariables({ command: "{{user}} vs {{user}}" }, { user: "ana" });
    expect(result.command).toBe("ana vs ana");
  });

  test("substitutes into url, body and headers", () => {
    const config: MacroConfig = {
      url: "https://example.com/{{target}}",
      body: '{"who":"{{name}}"}',
      headers: { Authorization: "Bearer {{token}}" },
    };
    const result = applyMacroVariables(config, { target: "abc", name: "ana", token: "t0ken" });
    expect(result.url).toBe("https://example.com/abc");
    expect(result.body).toBe('{"who":"ana"}');
    expect(result.headers).toEqual({ Authorization: "Bearer t0ken" });
  });

  test("leaves the literal token when a value is missing, so the mistake stays visible", () => {
    const result = applyMacroVariables({ command: "!so {{channel}}" }, {});
    expect(result.command).toBe("!so {{channel}}");
  });

  test("leaves engine expressions untouched", () => {
    const result = applyMacroVariables({ command: `${ENGINE_EXPRESSION} {{extra}}` }, { extra: "x" });
    expect(result.command).toBe(`${ENGINE_EXPRESSION} x`);
  });

  test("does not mutate the input config", () => {
    const config: MacroConfig = { command: "!so {{channel}}", headers: { A: "{{v}}" } };
    applyMacroVariables(config, { channel: "x", v: "y" });
    expect(config.command).toBe("!so {{channel}}");
    expect(config.headers).toEqual({ A: "{{v}}" });
  });

  test("passes picker-backed fields through unchanged", () => {
    const result = applyMacroVariables({ workflowId: "wf-1", method: "POST" }, { anything: "x" });
    expect(result.workflowId).toBe("wf-1");
    expect(result.method).toBe("POST");
  });
});

describe("chatCommandParts", () => {
  test("reads the command word and its text from separate fields", () => {
    expect(chatCommandParts({ command: "so", commandText: " wolfymaster " })).toEqual({
      command: "so",
      text: "wolfymaster",
    });
  });

  test("splits a typed line at the first whitespace", () => {
    expect(chatCommandParts({ command: "!sr life is a highway" })).toEqual({
      command: "sr",
      text: "life is a highway",
    });
  });

  test("treats a lone typed word as a command with no text", () => {
    expect(chatCommandParts({ command: "!lurk" })).toEqual({ command: "lurk", text: "" });
  });
});

describe("send-message and command text variables", () => {
  test("finds variables in a chat message and in command text", () => {
    expect(extractMacroVariables({ message: "hi {{who}}", commandText: "{{channel}}" })).toEqual(["who", "channel"]);
  });

  test("fills them in", () => {
    const resolved = applyMacroVariables({ message: "hi {{who}}", commandText: "{{who}}" }, { who: "chat" });
    expect(resolved.message).toBe("hi chat");
    expect(resolved.commandText).toBe("chat");
  });
});
