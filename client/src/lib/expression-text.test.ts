import { describe, expect, test } from "bun:test";
import { EXPRESSION_FUNCTIONS } from "@woofx3/api/expression";
import { EXPRESSION_FUNCTION_HELP } from "./expression-functions";
import { expressionCalls, expressionReferences, shortenExpressions } from "./expression-text";

describe("expression text", () => {
  const cases: { expr: string; references: string[]; calls: string[] }[] = [
    { expr: "trigger.data.amount", references: ["trigger.data.amount"], calls: [] },
    { expr: "round(a.b, 2)", references: ["a.b"], calls: ["round"] },
    { expr: "round (a.b)", references: ["a.b"], calls: ["round"] },
    { expr: "round(divide(step-1.x, -1.5))", references: ["step-1.x"], calls: ["round", "divide"] },
    { expr: "uppercase('a.b, (c)')", references: [], calls: ["uppercase"] },
    { expr: `lowercase("it's")`, references: [], calls: ["lowercase"] },
    { expr: "a.x ? true : null", references: ["a.x"], calls: [] },
    { expr: "items[0].name", references: ["items[0].name"], calls: [] },
    { expr: "round.result", references: ["round.result"], calls: [] },
  ];
  for (const { expr, references, calls } of cases) {
    test(expr, () => {
      expect(expressionReferences(expr)).toEqual(references);
      expect(expressionCalls(expr)).toEqual(calls);
    });
  }

  test("shortens every expression for reading", () => {
    expect(shortenExpressions("Hi ${trigger.data.name}, ${round(divide(trigger.data.bits, 100), 2)}")).toBe(
      "Hi {name}, {round(divide(bits, 100), 2)}"
    );
  });

  test("every function has help, and only those", () => {
    expect(EXPRESSION_FUNCTION_HELP.map((help) => help.name).sort()).toEqual(Object.keys(EXPRESSION_FUNCTIONS).sort());
  });
});
