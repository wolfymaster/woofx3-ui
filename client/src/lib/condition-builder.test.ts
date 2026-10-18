import { describe, expect, test } from "bun:test";
import type { ConditionConfig } from "@woofx3/api";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import {
  type ConditionField,
  comparesNumberAsText,
  conditionFields,
  conditionForField,
  conditionPhrase,
  conditionSourcesFor,
  conditionsSentence,
  fitsBuilder,
  fixNumbersAsText,
  labelFromPath,
  NO_ENGINE_CONDITION_SUPPORT,
  operatorChoices,
  patternProblem,
  selectedOperator,
  testPattern,
  triggerFieldChoices,
  triggerNamesViewer,
  VIEWER_GROUP,
  withOperator,
} from "./condition-builder";
import type { VariableOption } from "./workflow-variables";

function triggerRow(overrides: Partial<CatalogTriggerRow>): CatalogTriggerRow {
  return {
    id: "t1",
    name: "Subscription",
    description: "",
    category: "twitch",
    event: "channel.subscribe",
    ...overrides,
  } as CatalogTriggerRow;
}

const AMOUNT: ConditionField = {
  ref: `\${trigger.data.amount}`,
  label: "Amount",
  group: "From the trigger",
  kind: "number",
};
const NAME: ConditionField = {
  ref: `\${trigger.data.userName}`,
  label: "User name",
  group: "From the trigger",
  kind: "text",
};
const TIER: ConditionField = {
  ref: `\${trigger.data.tier}`,
  label: "Tier",
  group: "From the trigger",
  kind: "choice",
  choices: [
    { value: "1000", label: "Tier 1" },
    { value: "2000", label: "Tier 2" },
  ],
};
const LEVEL: ConditionField = {
  ref: `\${trigger.data.level}`,
  label: "Level",
  group: "From the trigger",
  kind: "choice",
  choices: [
    { value: 1, label: "Low" },
    { value: 2, label: "High" },
  ],
};
const FIRST: ConditionField = {
  ref: `\${trigger.data.first}`,
  label: "First",
  group: "From the trigger",
  kind: "boolean",
};
const FIELDS = [AMOUNT, NAME, TIER, LEVEL, FIRST];

describe("triggerFieldChoices", () => {
  test("reads an emitted field's own options", () => {
    const row = triggerRow({
      emits: [{ path: "tier", type: "string", options: [{ value: "1000", label: "Tier 1" }] }],
    });
    expect(triggerFieldChoices(row).get("tier")).toEqual([{ value: "1000", label: "Tier 1" }]);
  });

  test("borrows the options of a select setting naming the field by its eventPath", () => {
    const row = triggerRow({
      emits: [{ path: "level", type: "number" }],
      configFields: [
        {
          id: "level",
          label: "Level",
          type: "select",
          eventPath: "level",
          options: [
            { value: "1", label: "Low" },
            { value: "2", label: "High" },
          ],
        },
      ],
    });
    // A number field carries numbers, so the select's text values are read as numbers.
    expect(triggerFieldChoices(row).get("level")).toEqual([
      { value: 1, label: "Low" },
      { value: 2, label: "High" },
    ]);
  });

  test("prefers the field's own options over a select's", () => {
    const row = triggerRow({
      emits: [{ path: "tier", type: "string", options: [{ value: "1000", label: "Tier one" }] }],
      configFields: [
        { id: "tier", label: "Tier", type: "select", eventPath: "tier", options: [{ value: "1000", label: "T1" }] },
      ],
    });
    expect(triggerFieldChoices(row).get("tier")).toEqual([{ value: "1000", label: "Tier one" }]);
  });

  test("ignores a malformed options list", () => {
    const row = triggerRow({ emits: [{ path: "tier", type: "string", options: [{ value: "1000" }] }] });
    expect(triggerFieldChoices(row).has("tier")).toBe(false);
  });
});

describe("triggerNamesViewer", () => {
  test("is true for exactly one string identity", () => {
    expect(triggerNamesViewer(triggerRow({ emits: [{ path: "userId", type: "string", identity: "viewer" }] }))).toBe(
      true
    );
  });

  test("is false for an array identity, several identities, or none", () => {
    expect(triggerNamesViewer(triggerRow({ emits: [{ path: "ids", type: "array", identity: "viewer" }] }))).toBe(false);
    expect(
      triggerNamesViewer(
        triggerRow({
          emits: [
            { path: "a", type: "string", identity: "viewer" },
            { path: "b", type: "string", identity: "viewer" },
          ],
        })
      )
    ).toBe(false);
    expect(triggerNamesViewer(triggerRow({ emits: [{ path: "a", type: "string" }] }))).toBe(false);
    expect(triggerNamesViewer(undefined)).toBe(false);
  });
});

describe("conditionFields", () => {
  const variables: VariableOption[] = [
    { value: `\${trigger.data.userName}`, label: "userName", group: "Trigger", type: "string" },
    { value: `\${trigger.data.tier}`, label: "tier", group: "Trigger", type: "string" },
    { value: `\${add.position}`, label: "position", group: "Add to queue", type: "number" },
    { value: `\${wait.lastEvent}`, label: "lastEvent", group: "Wait (wait)", type: "object" },
  ];
  const ready = {
    status: "ready" as const,
    facts: [
      { path: "id", name: "Viewer ID", description: "", valueKind: "string" as const },
      {
        path: "user.last_seen",
        name: "Last seen",
        description: "",
        valueKind: "timestamp" as const,
        window: "lifetime" as const,
      },
    ],
  };

  test("labels, groups and types what the step can read", () => {
    const fields = conditionFields({
      variables,
      triggerChoices: new Map([["tier", [{ value: "1000", label: "Tier 1" }]]]),
      viewerFacts: ready,
      namesViewer: false,
    });
    expect(fields).toEqual([
      { ref: `\${trigger.data.userName}`, label: "User name", group: "From the trigger", kind: "text" },
      {
        ref: `\${trigger.data.tier}`,
        label: "Tier",
        group: "From the trigger",
        kind: "choice",
        choices: [{ value: "1000", label: "Tier 1" }],
      },
      { ref: `\${add.position}`, label: "Position (Add to queue)", group: "From Add to queue", kind: "number" },
      { ref: `\${wait.lastEvent}`, label: "Last event (Wait (wait))", group: "From Wait (wait)", kind: "collection" },
    ]);
  });

  test("adds the viewer's facts only when the trigger names a viewer", () => {
    const fields = conditionFields({ variables: [], triggerChoices: new Map(), viewerFacts: ready, namesViewer: true });
    expect(fields).toEqual([
      { ref: `\${viewer.id}`, label: "Viewer ID", group: VIEWER_GROUP, kind: "text" },
      { ref: `\${viewer.user.last_seen}`, label: "Last seen", group: VIEWER_GROUP, kind: "number" },
    ]);
  });

  test("offers no viewer facts while they load or when the engine has none to give", () => {
    for (const viewerFacts of [
      { status: "loading" as const },
      { status: "unavailable" as const, reason: "unsupported" as const },
    ]) {
      expect(conditionFields({ variables: [], triggerChoices: new Map(), viewerFacts, namesViewer: true })).toEqual([]);
    }
  });

  test("conditionSourcesFor reads the trigger's choices and viewer", () => {
    const row = triggerRow({
      emits: [{ path: "userId", type: "string", identity: "viewer" }],
    });
    const sources = conditionSourcesFor([], row, NO_ENGINE_CONDITION_SUPPORT);
    expect(sources.namesViewer).toBe(true);
    expect(sources.fields).toEqual([]);
  });
});

describe("labelFromPath", () => {
  test.each([
    ["userName", "User name"],
    ["CreatedByType", "Created by type"],
    ["data.goal_name", "Goal name"],
    ["ID", "Id"],
  ])("reads %s as %s", (path, label) => {
    expect(labelFromPath(path)).toBe(label);
  });
});

describe("operators", () => {
  test("follow the field's kind and are all ones the engine evaluates", () => {
    expect(operatorChoices("number").map((c) => c.id)).toContain("between");
    expect(operatorChoices("number").map((c) => c.id)).not.toContain("contains");
    expect(operatorChoices("text").map((c) => c.id)).toContain("regex");
    expect(operatorChoices("text").map((c) => c.id)).not.toContain("gt");
    expect(operatorChoices("choice").map((c) => c.id)).toEqual(["eq", "ne", "in", "not_in", "exists", "not_exists"]);
    expect(operatorChoices("collection").map((c) => c.id)).toEqual(["exists", "not_exists"]);
  });

  test("a yes-or-no field's is true and is false are eq with a fixed value", () => {
    const isFalse = operatorChoices("boolean").find((c) => c.id === "false");
    expect(isFalse).toMatchObject({ operator: "eq", fixedValue: false });
    expect(selectedOperator("boolean", { field: FIRST.ref, operator: "eq", value: true })?.id).toBe("true");
    expect(selectedOperator("boolean", { field: FIRST.ref, operator: "eq", value: "true" })).toBeUndefined();
  });
});

describe("conditionForField and withOperator", () => {
  test("a picked field starts on its first comparison", () => {
    expect(conditionForField(AMOUNT)).toEqual({ field: AMOUNT.ref, operator: "eq", value: "" });
    expect(conditionForField(TIER)).toEqual({ field: TIER.ref, operator: "eq", value: "1000" });
    expect(conditionForField(FIRST)).toEqual({ field: FIRST.ref, operator: "eq", value: true });
    expect(conditionForField({ ...NAME, kind: "collection" })).toEqual({ field: NAME.ref, operator: "exists" });
  });

  const choice = (kind: ConditionField["kind"], id: string) => {
    const found = operatorChoices(kind).find((c) => c.id === id);
    if (!found) {
      throw new Error(`no ${id} for ${kind}`);
    }
    return found;
  };

  test("a single value becomes a list's first item and back", () => {
    const one: ConditionConfig = { field: TIER.ref, operator: "eq", value: "2000" };
    const many = withOperator(one, TIER, choice("choice", "in"));
    expect(many).toEqual({ field: TIER.ref, operator: "in", value: ["2000"] });
    expect(withOperator(many, TIER, choice("choice", "eq"))).toEqual(one);
  });

  test("between starts with two empty bounds and drops a value it cannot use", () => {
    const at: ConditionConfig = { field: AMOUNT.ref, operator: "gte", value: 5 };
    expect(withOperator(at, AMOUNT, choice("number", "between"))).toEqual({
      field: AMOUNT.ref,
      operator: "between",
      value: ["", ""],
    });
    expect(withOperator(at, AMOUNT, choice("number", "exists"))).toEqual({ field: AMOUNT.ref, operator: "exists" });
  });
});

describe("fitsBuilder", () => {
  test.each<[string, ConditionConfig, boolean]>([
    ["a number", { field: AMOUNT.ref, operator: "gte", value: 100 }, true],
    ["an empty number", { field: AMOUNT.ref, operator: "gte", value: "" }, true],
    ["a number as text", { field: AMOUNT.ref, operator: "gte", value: "100" }, true],
    ["a reference", { field: AMOUNT.ref, operator: "gte", value: `\${trigger.data.goal}` }, false],
    ["a between", { field: AMOUNT.ref, operator: "between", value: [1, 10] }, true],
    ["a between with a referenced bound", { field: AMOUNT.ref, operator: "between", value: [1, `\${x.y}`] }, false],
    ["a known choice", { field: TIER.ref, operator: "in", value: ["1000", "2000"] }, true],
    ["an unknown choice", { field: TIER.ref, operator: "eq", value: "4000" }, false],
    ["text compared with text", { field: NAME.ref, operator: "contains", value: "wolf" }, true],
    ["an operator the kind does not offer", { field: NAME.ref, operator: "gt", value: "a" }, false],
    ["a field the builder does not offer", { field: `\${env.X}`, operator: "eq", value: "a" }, false],
  ])("%s: %s", (_label, condition, fits) => {
    expect(
      fitsBuilder(
        condition,
        FIELDS.find((f) => f.ref === condition.field)
      )
    ).toBe(fits);
  });
});

describe("numbers compared as text", () => {
  test("are found on a number field, in a single value, a list or a bound", () => {
    expect(comparesNumberAsText({ field: AMOUNT.ref, operator: "gt", value: "100" }, AMOUNT)).toBe(true);
    expect(comparesNumberAsText({ field: AMOUNT.ref, operator: "between", value: [1, "10"] }, AMOUNT)).toBe(true);
    expect(comparesNumberAsText({ field: AMOUNT.ref, operator: "gt", value: 100 }, AMOUNT)).toBe(false);
    expect(comparesNumberAsText({ field: NAME.ref, operator: "eq", value: "007" }, NAME)).toBe(false);
    // A choice whose values are text keeps them as text.
    expect(comparesNumberAsText({ field: TIER.ref, operator: "eq", value: "1000" }, TIER)).toBe(false);
    expect(comparesNumberAsText({ field: LEVEL.ref, operator: "in", value: ["1"] }, LEVEL)).toBe(true);
  });

  test("are fixed by storing the number they spell", () => {
    expect(fixNumbersAsText({ field: AMOUNT.ref, operator: "between", value: ["1", "10"] }, AMOUNT)).toEqual({
      field: AMOUNT.ref,
      operator: "between",
      value: [1, 10],
    });
    expect(fixNumbersAsText({ field: LEVEL.ref, operator: "in", value: ["1", "9"] }, LEVEL)).toEqual({
      field: LEVEL.ref,
      operator: "in",
      value: [1, "9"],
    });
  });
});

describe("sentences", () => {
  test("read each row by its labels", () => {
    expect(conditionPhrase({ field: AMOUNT.ref, operator: "gte", value: 100 }, FIELDS)).toBe("amount is at least 100");
    expect(conditionPhrase({ field: AMOUNT.ref, operator: "between", value: [5, 10] }, FIELDS)).toBe(
      "amount is between 5 and 10"
    );
    expect(conditionPhrase({ field: TIER.ref, operator: "in", value: ["1000", "2000"] }, FIELDS)).toBe(
      "tier is one of Tier 1 or Tier 2"
    );
    expect(conditionPhrase({ field: NAME.ref, operator: "eq", value: "wolfy" }, FIELDS)).toBe("user name is “wolfy”");
    expect(conditionPhrase({ field: NAME.ref, operator: "regex", value: "^w" }, FIELDS)).toBe(
      "user name matches the pattern /^w/"
    );
    expect(conditionPhrase({ field: FIRST.ref, operator: "eq", value: false }, FIELDS)).toBe("first is false");
    expect(conditionPhrase({ field: AMOUNT.ref, operator: "exists" }, FIELDS)).toBe("amount has a value");
  });

  test("mark a value not filled in, and keep a field the builder does not offer as written", () => {
    expect(conditionPhrase({ field: AMOUNT.ref, operator: "gte", value: "" }, FIELDS)).toBe("amount is at least …");
    expect(conditionPhrase({ field: `\${env.MODE}`, operator: "eq", value: "live" }, FIELDS)).toBe(
      `\${env.MODE} is “live”`
    );
  });

  test("join rows the way the engine combines them", () => {
    const rows: ConditionConfig[] = [
      { field: AMOUNT.ref, operator: "gt", value: 1 },
      { field: FIRST.ref, operator: "eq", value: true },
    ];
    expect(conditionsSentence(rows, "or", FIELDS)).toBe("amount is more than 1 or first is true");
    expect(conditionsSentence(rows, undefined, FIELDS)).toBe("amount is more than 1 and first is true");
  });
});

describe("patterns", () => {
  test("are tested on a sample", () => {
    expect(testPattern("spotify\\.com|youtu", "https://open.spotify.com/x")).toBe(true);
    expect(testPattern("^abc$", "abcd")).toBe(false);
  });

  test("reject what the engine's regular expressions cannot run", () => {
    expect(patternProblem("foo(?=bar)")).not.toBeNull();
    expect(patternProblem("(a)\\1")).not.toBeNull();
    expect(patternProblem("(")).not.toBeNull();
    expect(patternProblem("a|b")).toBeNull();
    expect(testPattern("(", "x")).toBeNull();
  });
});
