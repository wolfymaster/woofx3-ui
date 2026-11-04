import { describe, expect, test } from "bun:test";
import { DEFAULT_MODERATION_CONFIG, type ModerationAction } from "@woofx3/api/moderation-config";
import {
  configProblem,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_WARN_REASON,
  needsBanConfirm,
  parseNameList,
  phraseProblem,
  ruleOf,
  toggleAction,
  withRule,
} from "./chat-moderation-form";

const kinds = (actions: ModerationAction[]) => actions.map((action) => action.kind);

describe("toggleAction", () => {
  const rows: Array<
    [name: string, from: ModerationAction[], kind: ModerationAction["kind"], on: boolean, to: string[]]
  > = [
    ["adds a warn after the delete", [{ kind: "delete" }], "warn", true, ["delete", "warn"]],
    ["adds a delete before the warn", [{ kind: "warn", reason: "x" }], "delete", true, ["delete", "warn"]],
    [
      "swaps a timeout for a ban",
      [{ kind: "delete" }, { kind: "timeout", durationSeconds: 60 }],
      "ban",
      true,
      ["delete", "ban"],
    ],
    ["swaps a ban for a timeout", [{ kind: "ban" }], "timeout", true, ["timeout"]],
    ["removes an action", [{ kind: "delete" }, { kind: "ban" }], "ban", false, ["delete"]],
    ["keeps the last action", [{ kind: "delete" }], "delete", false, ["delete"]],
    ["adds nothing twice", [{ kind: "delete" }], "delete", true, ["delete"]],
  ];
  for (const [name, from, kind, on, to] of rows) {
    test(name, () => {
      expect(kinds(toggleAction(from, kind, on))).toEqual(to);
    });
  }

  test("a new warn and timeout start with their defaults", () => {
    expect(toggleAction([], "warn", true)).toEqual([{ kind: "warn", reason: DEFAULT_WARN_REASON }]);
    expect(toggleAction([], "timeout", true)).toEqual([{ kind: "timeout", durationSeconds: DEFAULT_TIMEOUT_SECONDS }]);
  });
});

describe("needsBanConfirm", () => {
  test("only when ban is being switched on", () => {
    expect(needsBanConfirm([{ kind: "delete" }], "ban", true)).toBe(true);
    expect(needsBanConfirm([{ kind: "ban" }], "ban", true)).toBe(false);
    expect(needsBanConfirm([{ kind: "ban" }], "ban", false)).toBe(false);
    expect(needsBanConfirm([{ kind: "delete" }], "timeout", true)).toBe(false);
  });
});

describe("phraseProblem", () => {
  const rows: Array<[pattern: string, problem: string | null]> = [
    ["bad*word", null],
    ["\\bfoo\\b", null],
    ["(a|b)", 'This phrase "(" has no meaning here; escape it with \\ to match it literally.'],
    ["a", "This phrase needs at least 2 letters or [classes], so it never matches nearly everything."],
    ["", "This phrase must not be empty."],
  ];
  for (const [pattern, problem] of rows) {
    test(JSON.stringify(pattern), () => {
      expect(phraseProblem(pattern)).toBe(problem);
    });
  }
});

describe("configProblem and rules", () => {
  test("a filter without a rule starts off, delete only, with its defaults, and saves", () => {
    const rule = ruleOf(DEFAULT_MODERATION_CONFIG, "links");
    expect(rule).toEqual({
      enabled: false,
      actions: [{ kind: "delete" }],
      params: { allowDomains: [], permitSeconds: 60 },
    });
    expect(configProblem(withRule(DEFAULT_MODERATION_CONFIG, "links", { ...rule, enabled: true }))).toBeNull();
  });

  test("names the engine's problem with a config", () => {
    const rule = { ...ruleOf(DEFAULT_MODERATION_CONFIG, "caps"), actions: [{ kind: "warn", reason: "/ban" } as const] };
    expect(configProblem(withRule(DEFAULT_MODERATION_CONFIG, "caps", rule))).toContain('must not start with "/"');
  });
});

describe("parseNameList", () => {
  test("splits on lines and commas and drops blanks", () => {
    expect(parseNameList("one, two\n\n three ,")).toEqual(["one", "two", "three"]);
  });
});
