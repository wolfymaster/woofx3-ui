import { describe, expect, test } from "bun:test";
import {
  checkFormQuestions,
  type FormField,
  type PageProblem,
  ProblemReport,
  USER_PAGE_LIMITS,
} from "@shared/user-pages";
import {
  formFieldOfType,
  newFormField,
  nudge,
  parseWholeNumber,
  removeAt,
  replaceAt,
  widgetSummary,
} from "@/lib/user-page-widgets";

describe("newFormField", () => {
  test("passes the shared checks once it has a question", () => {
    const field = { ...newFormField("q1"), label: "Your name?" };
    const problems: PageProblem[] = [];
    checkFormQuestions([field], ProblemReport.root(problems));
    expect(problems).toEqual([]);
  });
});

describe("formFieldOfType", () => {
  const long: FormField = { id: "q", label: "Story", required: true, type: "textarea", maxLength: 3000 };

  test("keeps the shared settings", () => {
    const next = formFieldOfType(long, "checkbox");
    expect(next).toEqual({ id: "q", label: "Story", required: true, type: "checkbox" });
  });

  test("clamps a long answer's length moving to a short answer", () => {
    expect(formFieldOfType(long, "text")).toEqual({
      id: "q",
      label: "Story",
      required: true,
      type: "text",
      maxLength: USER_PAGE_LIMITS.formTextAnswerLength,
    });
  });

  test("a choice starts with no options", () => {
    expect(formFieldOfType(long, "select")).toEqual({
      id: "q",
      label: "Story",
      required: true,
      type: "select",
      options: [],
    });
  });

  test("a checkbox becoming text gets the longest length allowed", () => {
    const checkbox: FormField = { id: "q", label: "Agree", required: false, type: "checkbox" };
    expect(formFieldOfType(checkbox, "textarea")).toMatchObject({
      maxLength: USER_PAGE_LIMITS.formTextareaAnswerLength,
    });
  });

  test("the same type is unchanged", () => {
    expect(formFieldOfType(long, "textarea")).toBe(long);
  });
});

describe("parseWholeNumber", () => {
  test.each([
    ["120", 120],
    ["", 0],
    ["abc", 0],
    ["12.7", 12],
  ])("%p reads as %p", (input, expected) => {
    expect(parseWholeNumber(input)).toBe(expected);
  });
});

describe("list helpers", () => {
  test("nudge swaps with a neighbour and stops at the ends", () => {
    expect(nudge(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(nudge(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(nudge(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(nudge(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  test("replaceAt and removeAt work on one index", () => {
    expect(replaceAt(["a", "b"], 1, "x")).toEqual(["a", "x"]);
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("widgetSummary", () => {
  test("says what each widget holds", () => {
    expect(widgetSummary({ id: "w", type: "text", config: { markdown: "Hello\nmore" } })).toBe("Hello");
    expect(widgetSummary({ id: "w", type: "counter", config: { resource: "", showGoals: true } })).toBe(
      "Not chosen yet"
    );
    expect(widgetSummary({ id: "w", type: "timer", config: { resource: "woofx3:timer:t", label: "Break" } })).toBe(
      "Break"
    );
    expect(widgetSummary({ id: "w", type: "links", config: { links: [{ label: "a", url: "https://a" }] } })).toBe(
      "1 link"
    );
    expect(widgetSummary({ id: "w", type: "form", config: { resource: "" } })).toBe("Not chosen yet");
  });
});
