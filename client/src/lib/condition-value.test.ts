import { describe, expect, test } from "bun:test";
import { conditionFieldType, conditionValueProblem, conditionValueText, parseConditionValue } from "./condition-value";
import type { VariableOption } from "./workflow-variables";

const VARIABLES: VariableOption[] = [
  { value: `\${trigger.data.amount}`, label: "amount", group: "Trigger", type: "number" },
  { value: `\${trigger.data.user}`, label: "user", group: "Trigger", type: "string" },
];

describe("parseConditionValue", () => {
  test("stores a number for a numeric comparison whatever the field", () => {
    for (const operator of ["gt", "gte", "lt", "lte"] as const) {
      expect(parseConditionValue(operator, "100")).toBe(100);
      expect(parseConditionValue(operator, " 2.5 ", "string")).toBe(2.5);
    }
    expect(parseConditionValue("gt", "-1e3")).toBe(-1000);
    expect(parseConditionValue("gt", ".5")).toBe(0.5);
  });

  test("keeps text that is not a plain decimal number", () => {
    expect(parseConditionValue("gt", "abc")).toBe("abc");
    expect(parseConditionValue("gt", "0x10")).toBe("0x10");
    expect(parseConditionValue("gt", "Infinity")).toBe("Infinity");
    expect(parseConditionValue("gt", "")).toBe("");
  });

  test("keeps a variable reference as the string the engine resolves", () => {
    expect(parseConditionValue("gt", `\${trigger.data.amount}`)).toBe(`\${trigger.data.amount}`);
    expect(parseConditionValue("eq", `\${tasks.count.next}`, "number")).toBe(`\${tasks.count.next}`);
  });

  test("stores between as two numbers", () => {
    expect(parseConditionValue("between", "1, 10")).toEqual([1, 10]);
    expect(parseConditionValue("between", "1,")).toEqual([1]);
    expect(parseConditionValue("between", "a, 10")).toEqual(["a", 10]);
  });

  test("types eq and ne only when the field holds a number", () => {
    expect(parseConditionValue("eq", "100", "number")).toBe(100);
    expect(parseConditionValue("ne", "100", "range")).toBe(100);
    expect(parseConditionValue("eq", "007", "string")).toBe("007");
    expect(parseConditionValue("eq", "007")).toBe("007");
    expect(parseConditionValue("eq", "abc", "number")).toBe("abc");
  });

  test("types in and not_in items only when the field holds a number", () => {
    expect(parseConditionValue("in", "1, 2, 3", "number")).toEqual([1, 2, 3]);
    expect(parseConditionValue("not_in", "1, 2", "string")).toEqual(["1", "2"]);
    expect(parseConditionValue("in", "a, , b")).toEqual(["a", "b"]);
  });

  test("keeps text for text operators and nothing for presence", () => {
    expect(parseConditionValue("contains", "100", "number")).toBe("100");
    expect(parseConditionValue("regex", "^\\d+$")).toBe("^\\d+$");
    expect(parseConditionValue("exists", "100")).toBeUndefined();
  });
});

describe("conditionValueText", () => {
  test("shows a stored value as it was typed", () => {
    expect(conditionValueText(100)).toBe("100");
    expect(conditionValueText(2.5)).toBe("2.5");
    expect(conditionValueText([1, 10])).toBe("1, 10");
    expect(conditionValueText("abc")).toBe("abc");
    expect(conditionValueText(undefined)).toBe("");
    expect(conditionValueText(null)).toBe("");
  });

  test("round-trips through parseConditionValue", () => {
    const cases = [
      { operator: "gte" as const, value: 100 },
      { operator: "between" as const, value: [1, 10] },
      { operator: "in" as const, value: ["a", "b"] },
      { operator: "eq" as const, value: "007" },
    ];
    for (const { operator, value } of cases) {
      expect(parseConditionValue(operator, conditionValueText(value))).toEqual(value);
    }
  });
});

describe("conditionValueProblem", () => {
  test("accepts numbers and references for a numeric comparison", () => {
    expect(conditionValueProblem("gt", "100")).toBeNull();
    expect(conditionValueProblem("lte", `\${trigger.data.amount}`)).toBeNull();
  });

  test("reports text given to a numeric comparison", () => {
    expect(conditionValueProblem("gt", "abc")).toContain("Enter a number");
  });

  test("reports a between that is not exactly two numbers", () => {
    expect(conditionValueProblem("between", "1, 10")).toBeNull();
    expect(conditionValueProblem("between", "1")).toContain("exactly two");
    expect(conditionValueProblem("between", "1, 2, 3")).toContain("exactly two");
    expect(conditionValueProblem("between", "a, 10")).toContain("must be numbers");
  });

  test("reports a variable inside a list", () => {
    expect(conditionValueProblem("between", `1, \${trigger.data.amount}`)).toContain("can't contain variables");
    expect(conditionValueProblem("in", `a, \${trigger.data.user}`)).toContain("can't contain variables");
  });

  test("has nothing to report for a blank value or a text operator", () => {
    expect(conditionValueProblem("gt", "  ")).toBeNull();
    expect(conditionValueProblem("between", "")).toBeNull();
    expect(conditionValueProblem("eq", "abc")).toBeNull();
    expect(conditionValueProblem("contains", "abc")).toBeNull();
  });
});

describe("conditionFieldType", () => {
  test("is the type of the variable the field names", () => {
    expect(conditionFieldType(`\${trigger.data.amount}`, VARIABLES)).toBe("number");
    expect(conditionFieldType(` \${trigger.data.user} `, VARIABLES)).toBe("string");
  });

  test("is unknown for a field that is not exactly one variable", () => {
    expect(conditionFieldType(`\${trigger.data.other}`, VARIABLES)).toBeUndefined();
    expect(conditionFieldType(`\${trigger.data.amount}x`, VARIABLES)).toBeUndefined();
  });
});
