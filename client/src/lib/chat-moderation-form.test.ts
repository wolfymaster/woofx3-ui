import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODERATION_CONFIG,
  MODERATION_STEP_OUTCOMES,
  type ModerationAction,
} from "@woofx3/api/moderation-config";
import {
  actionsMissingScope,
  canSaveConfig,
  configActionsMissingScope,
  configProblem,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_WARN_REASON,
  needsBanConfirm,
  OUTCOME_LABELS,
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

  test("names the card a problem is on, in plain words", () => {
    const rule = { ...ruleOf(DEFAULT_MODERATION_CONFIG, "caps"), actions: [{ kind: "warn", reason: "/ban" } as const] };
    const config = withRule(DEFAULT_MODERATION_CONFIG, "caps", rule);
    expect(canSaveConfig(config)).toBe(false);
    expect(configProblem(config)).toBe(
      "Something under Capital letters can't be saved yet. Check those settings, then save again."
    );
  });

  test("says nothing above the page for a bad phrase, which is shown beside it, but still blocks saving", () => {
    const rule = {
      ...ruleOf(DEFAULT_MODERATION_CONFIG, "banned_phrases"),
      enabled: true,
      params: {
        phrases: [
          { pattern: "spoil*", wholeWord: true },
          { pattern: "bad\\Bphrase", wholeWord: true },
        ],
      },
    };
    const config = withRule(DEFAULT_MODERATION_CONFIG, "banned_phrases", rule);
    expect(phraseProblem("bad\\Bphrase")).not.toBeNull();
    expect(canSaveConfig(config)).toBe(false);
    expect(configProblem(config)).toBeNull();
  });

  test("names Banned phrases while its card is off, since its phrases aren't shown", () => {
    const rule = {
      ...ruleOf(DEFAULT_MODERATION_CONFIG, "banned_phrases"),
      enabled: false,
      params: { phrases: [{ pattern: "bad\\Bphrase", wholeWord: true }] },
    };
    expect(configProblem(withRule(DEFAULT_MODERATION_CONFIG, "banned_phrases", rule))).toBe(
      "Something under Banned phrases can't be saved yet. Check those settings, then save again."
    );
  });
});

describe("parseNameList", () => {
  test("splits on lines and commas and drops blanks", () => {
    expect(parseNameList("one, two\n\n three ,")).toEqual(["one", "two", "three"]);
  });
});

describe("scopes", () => {
  const ALL = ["moderator:manage:chat_messages", "moderator:manage:warnings", "moderator:manage:banned_users"];
  const without = (scope: string) => ALL.filter((granted) => granted !== scope);
  const actions: ModerationAction[] = [{ kind: "delete" }, { kind: "warn", reason: "x" }, { kind: "ban" }];
  const rows: Array<[name: string, granted: string[], missing: string[]]> = [
    ["a link with every scope", ALL, []],
    ["a link without warnings", without("moderator:manage:warnings"), ["warn"]],
    ["a link without message management", without("moderator:manage:chat_messages"), ["delete"]],
    ["a link without bans", without("moderator:manage:banned_users"), ["ban"]],
    ["a link with nothing", [], ["delete", "warn", "ban"]],
  ];
  for (const [name, granted, missing] of rows) {
    test(`actionsMissingScope: ${name}`, () => {
      expect(actionsMissingScope(actions, granted)).toEqual(missing);
    });
  }

  test("configActionsMissingScope counts enabled rules only, each action once", () => {
    const config = withRule(
      withRule(DEFAULT_MODERATION_CONFIG, "links", {
        ...ruleOf(DEFAULT_MODERATION_CONFIG, "links"),
        enabled: true,
        actions,
      }),
      "caps",
      {
        ...ruleOf(DEFAULT_MODERATION_CONFIG, "caps"),
        enabled: false,
        actions: [{ kind: "timeout", durationSeconds: 60 }],
      }
    );
    expect(configActionsMissingScope(config, [])).toEqual(["delete", "warn", "ban"]);
    expect(configActionsMissingScope(config, without("moderator:manage:warnings"))).toEqual(["warn"]);
  });

  test("every outcome has a label", () => {
    for (const outcome of MODERATION_STEP_OUTCOMES) {
      expect(OUTCOME_LABELS[outcome]).toBeString();
    }
  });
});
