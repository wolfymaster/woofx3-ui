import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  appendToken,
  isExpressionText,
  isWholeReference,
  MISSING_SETTING_MESSAGE,
  missingSettings,
  settingProblem,
  variablesForSetting,
  variableUse,
  withSetting,
} from "@/lib/action-settings";
import type { VariableOption } from "@/lib/workflow-variables";

const counter: ConfigField = {
  id: "target",
  label: "Counter",
  type: "resource_ref",
  resourceKind: "woofx3:counter",
  required: true,
};
const amount: ConfigField = { id: "amount", label: "Amount", type: "number", min: 1 };
const winners: ConfigField = {
  id: "winners",
  label: "Number of winners",
  type: "number",
  min: 1,
  max: 10,
  required: true,
};
const visible: ConfigField = { id: "visible", label: "Visible", type: "toggle", required: true };

describe("missingSettings", () => {
  test("lists the required settings with nothing in them", () => {
    expect(missingSettings([counter, amount, winners], {}).map((field) => field.label)).toEqual([
      "Counter",
      "Number of winners",
    ]);
  });

  test("counts blank text and an empty list as missing", () => {
    const message: ConfigField = { id: "message", label: "Message", type: "text", required: true };
    const goals: ConfigField = { id: "goals", label: "Goals", type: "list", required: true, itemFields: [] };
    expect(missingSettings([message, goals], { message: "   ", goals: [] })).toHaveLength(2);
  });

  test("never asks for a switch, which is always on or off", () => {
    expect(missingSettings([visible], {})).toEqual([]);
  });

  test("takes a value from earlier as filled", () => {
    expect(missingSettings([counter], { target: "${trigger.data.counter}" })).toEqual([]);
  });
});

describe("settingProblem", () => {
  test("asks for a required setting that is empty", () => {
    expect(settingProblem(counter, undefined)).toEqual({ kind: "missing", message: MISSING_SETTING_MESSAGE });
    expect(settingProblem(amount, undefined)).toBeNull();
  });

  test("names both bounds when a number declares both", () => {
    expect(settingProblem(winners, 11)).toEqual({ kind: "invalid", message: "Choose between 1 and 10." });
    expect(settingProblem(winners, 0)?.message).toBe("Choose between 1 and 10.");
    expect(settingProblem(winners, 10)).toBeNull();
  });

  test("names the one bound a number declares", () => {
    expect(settingProblem(amount, 0)?.message).toBe("Choose 1 or more.");
    expect(settingProblem({ ...amount, min: undefined, max: 5 }, 6)?.message).toBe("Choose 5 or less.");
  });

  test("checks both ends of a range, and that they are in order", () => {
    const entries: ConfigField = { id: "entries", label: "Entries", type: "range", min: 1, max: 5 };
    expect(settingProblem(entries, { type: "range", min: 1, max: 9 })?.message).toBe("Choose between 1 and 5.");
    expect(settingProblem(entries, { type: "range", min: 4, max: 2 })?.message).toBe(
      "The lowest can't be more than the highest."
    );
    expect(settingProblem(entries, { type: "single", value: 3 })).toBeNull();
  });

  test("leaves a value from earlier to be checked when the step runs", () => {
    expect(settingProblem(winners, "${trigger.data.viewers}")).toBeNull();
  });
});

describe("withSetting", () => {
  test("leaves a cleared setting out, so the action uses its own default", () => {
    expect(withSetting({ target: "a", amount: 2 }, "amount", "")).toEqual({ target: "a" });
    expect(withSetting({ target: "a" }, "target", null)).toEqual({});
    expect(withSetting({}, "amount", 0)).toEqual({ amount: 0 });
  });
});

describe("variableUse", () => {
  test("writes values into free text", () => {
    expect(variableUse({ type: "text" })).toBe("insert");
    expect(variableUse({ type: "text", source: { kind: "internal", request: { event: "x" } } })).toBe("insert");
  });

  test("replaces the whole value of a picked or typed control", () => {
    expect(variableUse({ type: "number" })).toBe("replace");
    expect(variableUse({ type: "resource_ref" })).toBe("replace");
    expect(variableUse({ type: "text", source: { kind: "scenes" } })).toBe("replace");
    expect(variableUse({ type: "asset" })).toBe("replace");
  });

  test("offers nothing for rows, canvases, buttons and themes", () => {
    for (const type of ["list", "layout", "button", "theme"] as const) {
      expect(variableUse({ type })).toBe("none");
    }
  });
});

describe("variablesForSetting", () => {
  const variables: VariableOption[] = [
    { value: "${trigger.data.user}", label: "user", group: "Trigger", type: "string" },
    { value: "${trigger.data.bits}", label: "bits", group: "Trigger", type: "number" },
    { value: "${wait.satisfied}", label: "satisfied", group: "Wait (wait)", type: "boolean" },
    { value: "${step.data}", label: "data", group: "Step" },
  ];

  test("gives a number numbers, and values of no declared type", () => {
    expect(variablesForSetting({ type: "number" }, variables).map((v) => v.label)).toEqual(["bits", "data"]);
  });

  test("gives a switch yes/no values", () => {
    expect(variablesForSetting({ type: "toggle" }, variables).map((v) => v.label)).toEqual(["satisfied", "data"]);
  });

  test("gives any other setting every value", () => {
    expect(variablesForSetting({ type: "text" }, variables)).toHaveLength(4);
  });
});

describe("isWholeReference and appendToken", () => {
  test("tells a whole reference from text that holds one", () => {
    expect(isWholeReference("${increment.next}")).toBe(true);
    expect(isWholeReference("Now at ${increment.next}")).toBe(false);
    expect(isWholeReference(5)).toBe(false);
  });

  test("adds a token after the text, a space apart", () => {
    expect(appendToken("Thanks", "${trigger.data.user}")).toBe("Thanks ${trigger.data.user}");
    expect(appendToken(undefined, "${trigger.data.user}")).toBe("${trigger.data.user}");
    expect(appendToken("Hi ", "${a.b}")).toBe("Hi ${a.b}");
  });
});

describe("an expression left as text", () => {
  const numberField = { id: "amount", label: "Amount", type: "number" } as ConfigField;

  test("is told apart from a reference and a number", () => {
    expect(isExpressionText("{round(divide(amount, 100))}")).toBe(true);
    expect(isExpressionText("{round(amount")).toBe(true);
    expect(isExpressionText("${trigger.data.amount}")).toBe(false);
    expect(isExpressionText("5 + {amount}")).toBe(true);
    expect(isExpressionText("{round(divide(${trigger.data.amount}, 100))}")).toBe(true);
    expect(isExpressionText("hello")).toBe(false);
    expect(isExpressionText(5)).toBe(false);
  });

  test("is a problem in a number setting", () => {
    expect(settingProblem(numberField, "{round(amount)}")?.kind).toBe("invalid");
    expect(settingProblem(numberField, "${round(trigger.data.amount)}")).toBeNull();
  });
});
