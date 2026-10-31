import { describe, expect, test } from "bun:test";
import { USER_PAGE_LIMITS } from "./limits";
import { type PageProblem, ProblemReport } from "./problems";
import {
  checkFormDefinition,
  type FormDefinition,
  type FormField,
  parseFormDefinition,
  parseFormFields,
} from "./widgets";

const EVERY_TYPE: FormField[] = [
  { id: "name", type: "text", label: "Name", required: true, maxLength: 50 },
  { id: "about", type: "textarea", label: "About", required: false, maxLength: 2000 },
  { id: "game", type: "select", label: "Game", required: true, options: [{ value: "a", label: "A" }] },
  { id: "ok", type: "checkbox", label: "Agree", required: true },
];

function problemsFor(definition: FormDefinition): string[] {
  const problems: PageProblem[] = [];
  checkFormDefinition(definition, ProblemReport.root(problems));
  return problems.map((problem) => problem.path);
}

const question = (overrides: { id?: string; label?: string }): FormField => ({
  id: "q1",
  label: "Question",
  type: "checkbox",
  required: false,
  ...overrides,
});

describe("checkFormDefinition", () => {
  test.each<[string, FormDefinition, string[]]>([
    ["every question type", { submitLabel: "Send", fields: EVERY_TYPE }, []],
    ["no button text", { submitLabel: "", fields: [] }, ["submitLabel"]],
    [
      "a text answer longer than the ceiling",
      {
        submitLabel: "Send",
        fields: [
          { id: "f", type: "text", label: "Q", required: false, maxLength: USER_PAGE_LIMITS.formTextAnswerLength + 1 },
        ],
      },
      ["fields[0].maxLength"],
    ],
    [
      "a choice with no options",
      { submitLabel: "Send", fields: [{ id: "f", type: "select", label: "Q", required: false, options: [] }] },
      ["fields[0].options"],
    ],
    [
      "repeated question ids",
      { submitLabel: "Send", fields: [question({ id: "f" }), question({ id: "f" })] },
      ["fields[1].id"],
    ],
    ["a question id of only digits", { submitLabel: "Send", fields: [question({ id: "123" })] }, ["fields[0].id"]],
    ["a NUL in the title", { title: "a\0", submitLabel: "Send", fields: [] }, ["title"]],
    [
      "a lone surrogate in a question",
      { submitLabel: "Send", fields: [question({ label: "a\ud800" })] },
      ["fields[0].label"],
    ],
  ])("%s", (_name, definition, paths) => {
    expect(problemsFor(definition)).toEqual(paths);
  });

  test("a question id workflows can read, digits and dashes or a uuid", () => {
    expect(problemsFor({ submitLabel: "Send", fields: [question({ id: "1-2" })] })).toEqual([]);
    expect(
      problemsFor({ submitLabel: "Send", fields: [question({ id: "3f2b1c9e-7a10-4d2e-9b11-0c6f5a7d8e21" })] })
    ).toEqual([]);
  });
});

describe("parseFormDefinition", () => {
  test("reads what the kind stores, and an empty title as none", () => {
    expect(parseFormDefinition({ title: "", submitLabel: "Send", fields: EVERY_TYPE, other: 1 })).toEqual({
      submitLabel: "Send",
      fields: EVERY_TYPE,
    });
    expect(parseFormDefinition({ title: "T", submitLabel: "Send", fields: EVERY_TYPE })?.title).toBe("T");
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["not an object", "form"],
    ["no questions yet", { submitLabel: "Send", fields: [] }],
    ["no questions setting", { submitLabel: "Send" }],
    ["no button text", { fields: EVERY_TYPE }],
    ["a question it can't read", { submitLabel: "Send", fields: [...EVERY_TYPE, { id: "x", type: "date" }] }],
    ["a question breaking the rules", { submitLabel: "Send", fields: [question({ id: "123" })] }],
  ])("nothing to show for %s", (_name, settings) => {
    expect(parseFormDefinition(settings)).toBeNull();
  });

  test("parseFormFields leaves out what it can't read", () => {
    expect(parseFormFields([EVERY_TYPE[0], { id: 1 }])).toEqual([EVERY_TYPE[0]]);
    expect(parseFormFields("nope")).toEqual([]);
  });
});
