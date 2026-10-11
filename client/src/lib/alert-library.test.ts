import { describe, expect, test } from "bun:test";
import { stackOrder } from "@woofx3/scene/model";
import {
  compositionOfLibraryAlert,
  describeLinks,
  inlineAlertParams,
  inlineCopyOfLibraryAlert,
  inputFieldsOf,
  inputVariableWarnings,
  type LibraryAlertDocument,
  libraryAlertOfStep,
  libraryJsonOf,
  linkedAlertParams,
  linkedCompositionId,
  linkedInputValues,
  unprovidedVariables,
} from "@/lib/alert-library";
import type { VariableOption } from "@/lib/workflow-variables";

const variable = (value: string, label = value, type = "string"): VariableOption => ({
  value,
  label,
  group: "Trigger",
  type,
});

function entry(id: string, zIndex: number, settings: Record<string, unknown> = {}) {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: id,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 100 },
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    settings,
  };
}

function libraryRow(overrides: Partial<LibraryAlertDocument> = {}): LibraryAlertDocument {
  return {
    widgets: [entry("bottom", 0), entry("top", 1, { text: "Thanks {{name}}!" })],
    layout: { width: 1280, height: 720 },
    behaviors: {},
    inputs: [{ id: "name", label: "Name", type: "text", defaultValue: "friend" }],
    ...overrides,
  };
}

describe("step parameters", () => {
  test("a step with its own layout links nothing", () => {
    expect(linkedCompositionId({ target: "default", layout: {} })).toBeNull();
    expect(linkedCompositionId({ composition: "" })).toBeNull();
    expect(linkedCompositionId(undefined)).toBeNull();
  });

  test("linking replaces the layout with the alert's id and the inputs, keeping the target", () => {
    const linked = linkedAlertParams({ target: "main", layout: { widgets: [] } }, "c-1", {
      name: "${trigger.data.user}",
    });
    expect(linked).toEqual({ target: "main", composition: "c-1", inputs: { name: "${trigger.data.user}" } });
    expect(linkedCompositionId(linked)).toBe("c-1");
    expect(linkedInputValues(linked)).toEqual({ name: "${trigger.data.user}" });
  });

  test("linking starts with no input values", () => {
    expect(linkedAlertParams({ target: "default" }, "c-1")).toEqual({
      target: "default",
      composition: "c-1",
      inputs: {},
    });
  });

  test("a step holds exactly one of layout and composition", () => {
    const inline = inlineAlertParams({ target: "main", composition: "c-1", inputs: { a: 1 } }, { widgets: [] });
    expect(inline).toEqual({ target: "main", layout: { widgets: [] } });
    const relinked = linkedAlertParams(inline, "c-2");
    expect(relinked).not.toHaveProperty("layout");
  });

  test("linking refuses an empty id", () => {
    expect(() => linkedAlertParams({}, "")).toThrow();
  });

  test("input values that are not an object read as none", () => {
    expect(linkedInputValues({ inputs: "nope" })).toEqual({});
  });
});

describe("inputFieldsOf", () => {
  test("keeps an input's field definition for the form", () => {
    const fields = inputFieldsOf([
      { id: "amount", label: "Amount", type: "number", min: 0 },
      { id: "sound", label: "Sound", type: "media", mediaType: "audio" },
    ]);
    expect(fields).toEqual([
      { id: "amount", label: "Amount", type: "number", min: 0 },
      { id: "sound", label: "Sound", type: "media", mediaType: "audio" },
    ]);
  });

  test("labels an input by its id and draws an unknown type as text", () => {
    expect(inputFieldsOf([{ id: "name", type: "fancy" }])).toEqual([{ id: "name", label: "name", type: "text" }]);
  });

  test("leaves out what cannot be an input", () => {
    expect(
      inputFieldsOf([{ id: "inner", type: "layout" }, { id: "go", type: "button" }, { label: "no id" }, "x", null])
    ).toEqual([]);
  });
});

describe("variable warnings", () => {
  const available = [variable("${trigger.data.user.name}"), variable("${trigger.data.amount}")];

  test("a variable the trigger provides is fine, as is the object above one", () => {
    expect(unprovidedVariables("${trigger.data.user.name} gave ${trigger.data.amount}", available)).toEqual([]);
    expect(unprovidedVariables("${trigger.data.user}", available)).toEqual([]);
  });

  test("a variable the trigger does not provide is named", () => {
    expect(unprovidedVariables("Hi ${trigger.data.viewers}", available)).toEqual(["${trigger.data.viewers}"]);
  });

  test("assets and expressions are not judged", () => {
    expect(unprovidedVariables("${asset:pleasure}", available)).toEqual([]);
    expect(unprovidedVariables("${trigger.data.amount * 2}", available)).toEqual([]);
  });

  test("values inside objects and lists are searched", () => {
    expect(unprovidedVariables({ a: ["${steps.x.out}"] }, available)).toEqual(["${steps.x.out}"]);
  });

  test("each input with a missing variable gets one warning", () => {
    const fields = inputFieldsOf([
      { id: "name", label: "Name", type: "text" },
      { id: "count", label: "Count", type: "number" },
    ]);
    const warnings = inputVariableWarnings(
      fields,
      { name: "${trigger.data.user.name}", count: "${trigger.data.months}" },
      available
    );
    expect(warnings).toEqual([{ inputId: "count", label: "Count", references: ["${trigger.data.months}"] }]);
  });
});

describe("compositionOfLibraryAlert", () => {
  test("reads the engine's stored placement list in stacking order, with its canvas", () => {
    const doc = compositionOfLibraryAlert(libraryRow());
    expect(stackOrder(doc)).toEqual(["bottom", "top"]);
    expect(doc.layout).toMatchObject({ width: 1280, height: 720 });
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks {{name}}!" });
  });

  test("gives a canvas without a size the default one", () => {
    expect(compositionOfLibraryAlert(libraryRow({ layout: {} })).layout).toMatchObject({ width: 1920, height: 1080 });
  });

  test("unescapes the keys Convex cannot store", () => {
    const doc = compositionOfLibraryAlert(libraryRow({ widgets: [entry("w", 0, { size: { __$input: "size" } })] }));
    expect(doc.widgets.w?.settings).toEqual({ size: { $input: "size" } });
  });

  test("keeps behaviors, and drops behaviors that are not an object", () => {
    const behavior = { type: "transition", kind: "fade", target: "top", order: "a0", timing: {}, params: {} };
    expect(compositionOfLibraryAlert(libraryRow({ behaviors: { b1: behavior } })).behaviors).toEqual({ b1: behavior });
    expect(compositionOfLibraryAlert(libraryRow({ behaviors: [1] })).behaviors).toEqual({});
  });
});

describe("inlineCopyOfLibraryAlert", () => {
  test("fills inputs in from the step's values", () => {
    const { doc, unfilled } = inlineCopyOfLibraryAlert(libraryRow(), { name: "${trigger.data.user}" });
    expect(unfilled).toEqual([]);
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks ${trigger.data.user}!" });
    expect(doc).not.toHaveProperty("inputs");
  });

  test("an input with no value takes its default", () => {
    const { doc } = inlineCopyOfLibraryAlert(libraryRow());
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks friend!" });
  });

  test("an input with neither is left empty and named", () => {
    const row = libraryRow({ inputs: [{ id: "name", label: "Name", type: "text" }] });
    const { doc, unfilled } = inlineCopyOfLibraryAlert(row);
    expect(unfilled).toEqual(["name"]);
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks !" });
  });
});

describe("libraryAlertOfStep", () => {
  test("turns each variable into an input the step fills in with that variable", () => {
    const step = compositionOfLibraryAlert(
      libraryRow({
        widgets: [
          entry("text", 0, { text: "${trigger.data.user} cheered ${trigger.data.amount} {{bits}}" }),
          entry("count", 1, { value: "${trigger.data.amount}" }),
        ],
        inputs: [],
      })
    );
    const available = [variable("${trigger.data.user}", "User"), variable("${trigger.data.amount}", "Bits", "number")];
    const { doc, values } = libraryAlertOfStep(step, available);
    expect(doc.inputs).toEqual([
      { id: "user", label: "User", type: "text" },
      { id: "amount", label: "Bits", type: "number" },
    ]);
    expect(values).toEqual({ user: "${trigger.data.user}", amount: "${trigger.data.amount}" });
    expect(doc.widgets.text?.settings).toEqual({ text: "{{user}} cheered {{amount}} \\{{bits}}" });
    expect(doc.widgets.count?.settings).toEqual({ value: { $input: "amount" } });
  });

  test("a library copy bound with those values plays what the step played", () => {
    const step = compositionOfLibraryAlert(
      libraryRow({ widgets: [entry("t", 0, { text: "Hi ${trigger.data.user}" })], inputs: [] })
    );
    const { doc, values } = libraryAlertOfStep(step, []);
    const stored = JSON.parse(libraryJsonOf(doc).inputsJson);
    const copy = inlineCopyOfLibraryAlert(
      { widgets: JSON.parse(libraryJsonOf(doc).widgetsJson), layout: doc.layout, behaviors: {}, inputs: stored },
      values
    );
    expect(copy.doc.widgets.t?.settings).toEqual({ text: "Hi ${trigger.data.user}" });
  });

  test("gives two variables with the same last segment different ids", () => {
    const step = compositionOfLibraryAlert(
      libraryRow({
        widgets: [entry("t", 0, { text: "${trigger.data.user.name} ${steps.lookup.name}" })],
        inputs: [],
      })
    );
    expect(libraryAlertOfStep(step, []).doc.inputs?.map((input) => input.id)).toEqual(["name", "name_2"]);
  });
});

describe("describeLinks", () => {
  test("names each step by its owner", () => {
    const names = { workflows: new Map([["wf-1", "Follow alerts"]]), commands: new Map([["cmd-1", "hype"]]) };
    const lines = describeLinks(
      [
        { ownerKind: "workflow", ownerId: "wf-1", stepId: "alert-1", createdAt: "", updatedAt: "" },
        { ownerKind: "command", ownerId: "cmd-1", stepId: "action-2", createdAt: "", updatedAt: "" },
        { ownerKind: "command", ownerId: "gone", stepId: "s", createdAt: "", updatedAt: "" },
      ],
      names
    );
    expect(lines).toEqual(["Follow alerts · step alert-1", "!hype · step action-2", "A chat command · step s"]);
  });
});
