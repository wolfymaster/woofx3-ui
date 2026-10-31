import { describe, expect, test } from "bun:test";
import { checkFormAnswers, emptyFormAnswers, type FormAnswers, isFormIdempotencyKey } from "./forms";
import type { FormField } from "./widgets";

const FIELDS: FormField[] = [
  { id: "t", type: "text", label: "T", required: true, maxLength: 3 },
  { id: "a", type: "textarea", label: "A", required: false, maxLength: 5 },
  { id: "s", type: "select", label: "S", required: true, options: [{ value: "x", label: "X" }] },
  { id: "c", type: "checkbox", label: "C", required: true },
];
const GOOD: FormAnswers = { t: "abc", a: "", s: "x", c: true };

describe("checkFormAnswers", () => {
  test("accepts answers that fit", () => {
    expect(checkFormAnswers(FIELDS, GOOD)).toEqual({ kind: "ok" });
  });

  test.each<[string, FormAnswers]>([
    ["a missing question", { t: "abc", s: "x", c: true }],
    ["an extra question", { ...GOOD, z: "?" }],
    ["text where a checkbox now is", { ...GOOD, c: "yes" }],
    ["a checkbox where text now is", { ...GOOD, t: true }],
    ["a choice no longer offered", { ...GOOD, s: "y" }],
  ])("%s is stale", (_name, answers) => {
    expect(checkFormAnswers(FIELDS, answers)).toEqual({ kind: "stale" });
  });

  test.each<[string, FormAnswers, string]>([
    ["blank required text", { ...GOOD, t: "   " }, "t"],
    ["too long", { ...GOOD, t: "abcd" }, "t"],
    ["no choice made", { ...GOOD, s: "" }, "s"],
    ["required box unticked", { ...GOOD, c: false }, "c"],
    ["a lone surrogate", { ...GOOD, t: "\ud800" }, "t"],
  ])("%s is invalid", (_name, answers, fieldId) => {
    const checked = checkFormAnswers(FIELDS, answers);
    expect(checked.kind === "invalid" && checked.problems.map((problem) => problem.fieldId)).toEqual([fieldId]);
  });

  test("an emoji pair is not a lone surrogate", () => {
    expect(checkFormAnswers(FIELDS, { ...GOOD, t: "\u{1F436}" })).toEqual({ kind: "ok" });
  });

  test("a form's empty answers cover every question", () => {
    expect(emptyFormAnswers(FIELDS)).toEqual({ t: "", a: "", s: "", c: false });
  });
});

test("isFormIdempotencyKey", () => {
  expect(isFormIdempotencyKey("a".repeat(43))).toBe(true);
  expect(isFormIdempotencyKey("short")).toBe(false);
  expect(isFormIdempotencyKey(`${"a".repeat(20)} `)).toBe(false);
});
