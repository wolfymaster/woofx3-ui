import { describe, expect, test } from "bun:test";
import {
  checkFormAnswers,
  deliverableText,
  emptyFormAnswers,
  type FormAnswers,
  hasUndeliverableText,
  isFormIdempotencyKey,
} from "./forms";
import { USER_PAGE_LIMITS } from "./limits";
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
    ["a NUL", { ...GOOD, t: "a\0" }, "t"],
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

describe("text the engine can't store", () => {
  test.each([
    ["plain text", "hello", false],
    ["an emoji pair", "\u{1F436}", false],
    ["a NUL", "a\0b", true],
    ["a lone high surrogate", "a\ud800", true],
    ["a lone low surrogate", "\udc00a", true],
  ])("%s", (_name, text, expected) => {
    expect(hasUndeliverableText(text)).toBe(expected);
    // Repeated because a global regex keeps state between calls if misused.
    expect(hasUndeliverableText(text)).toBe(expected);
  });

  test.each([
    ["removes NUL", "a\0b", 10, "ab"],
    ["removes a lone surrogate", "a\ud800b", 10, "ab"],
    ["keeps an emoji pair", "\u{1F436}", 10, "\u{1F436}"],
    ["cuts to length", "abcdef", 3, "abc"],
    ["never leaves half a pair at the cut", "a\u{1F436}", 2, "a"],
  ])("deliverableText %s", (_name, text, max, expected) => {
    expect(deliverableText(text, max)).toBe(expected);
  });
});

test("page limits fit what the engine takes", () => {
  const engine = { id: 255, text: 255, fields: 20, value: 5000 };
  expect(USER_PAGE_LIMITS.idLength).toBeLessThanOrEqual(engine.id);
  expect(USER_PAGE_LIMITS.labelLength).toBeLessThanOrEqual(engine.text);
  expect(USER_PAGE_LIMITS.deliveredTextLength).toBe(engine.text);
  expect(USER_PAGE_LIMITS.formFields).toBeLessThanOrEqual(engine.fields);
  expect(USER_PAGE_LIMITS.formTextAnswerLength).toBeLessThanOrEqual(engine.value);
  expect(USER_PAGE_LIMITS.formTextareaAnswerLength).toBeLessThanOrEqual(engine.value);
});
