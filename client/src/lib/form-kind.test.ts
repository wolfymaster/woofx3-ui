import { describe, expect, test } from "bun:test";
import type { FormField } from "@shared/user-pages";
import { FORM_SUBMITTED_EVENT, formAnswerReference, formAnswerVariables, formQueueEntryChoices } from "@/lib/form-kind";
import type { TriggerNode } from "@/lib/workflow-tree";

const FIELDS: FormField[] = [
  { id: "song", type: "text", label: "Song", required: true, maxLength: 20 },
  { id: "ok", type: "checkbox", label: "I follow", required: false },
];
const FORM = { canonicalId: "woofx3:form:requests", settings: { submitLabel: "Send", fields: FIELDS } };

function trigger(event: string, formId?: string): TriggerNode {
  return {
    type: "trigger",
    id: "trigger",
    event,
    conditions: formId === undefined ? [] : [{ field: "${trigger.data.formId}", operator: "eq", value: formId }],
  } as TriggerNode;
}

test("formAnswerReference is the path the form trigger's event carries an answer at", () => {
  expect(formAnswerReference("a-1")).toBe("${trigger.data.answers.a-1}");
});

describe("formAnswerVariables", () => {
  test("names each question of the form the trigger is narrowed to", () => {
    const options = formAnswerVariables(trigger(FORM_SUBMITTED_EVENT, FORM.canonicalId), [FORM]);
    expect(options.map(({ value, label, type }) => ({ value, label, type }))).toEqual([
      { value: "${trigger.data.answers.song}", label: "Song", type: "string" },
      { value: "${trigger.data.answers.ok}", label: "I follow", type: "boolean" },
    ]);
  });

  test.each([
    ["any form", trigger(FORM_SUBMITTED_EVENT)],
    ["a form that's gone", trigger(FORM_SUBMITTED_EVENT, "woofx3:form:gone")],
    ["another event", trigger("queue.added", FORM.canonicalId)],
  ])("offers nothing for %s", (_name, node) => {
    expect(formAnswerVariables(node, [FORM])).toEqual([]);
  });
});

test("formQueueEntryChoices leaves out checkboxes and always offers the viewer's name", () => {
  expect(formQueueEntryChoices(FIELDS)).toEqual([
    { value: "${trigger.data.answers.song}", label: "Song" },
    { value: "${trigger.data.viewer.displayName}", label: "The viewer's name" },
  ]);
});
