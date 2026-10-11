import { describe, expect, test } from "bun:test";
import { bindInputs, stackOrder } from "@woofx3/scene/model";
import {
  compositionOfLibraryAlert,
  inlineCopyOfLibraryAlert,
  inputVariableOptions,
  type LibraryAlertDocument,
  libraryAlertOfStep,
  libraryJsonOf,
  libraryPreviewInputs,
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

describe("compositionOfLibraryAlert inputs", () => {
  test("declares the alert's inputs, so its own references bind", () => {
    const doc = compositionOfLibraryAlert(libraryRow());
    expect(doc.inputs).toEqual([{ id: "name", label: "Name", type: "text", defaultValue: "friend" }]);
    expect(bindInputs(doc, {}).ok).toBe(true);
  });

  test("keeps the first declaration of an id and drops inputs with none", () => {
    const doc = compositionOfLibraryAlert(
      libraryRow({
        inputs: [{ id: "name", label: "First" }, { id: "name", label: "Second" }, { label: "No id" }, "name"],
      })
    );
    expect(doc.inputs).toEqual([{ id: "name", label: "First" }]);
  });
});

describe("inlineCopyOfLibraryAlert", () => {
  const userName = variable("${trigger.data.user.name}");

  test("fills an input with the step's variable it is named after", () => {
    const available = [variable("${trigger.data.amount}"), userName];
    const { doc, unfilled } = inlineCopyOfLibraryAlert(libraryRow(), available);
    expect(unfilled).toEqual([]);
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks ${trigger.data.user.name}!" });
    expect(doc).not.toHaveProperty("inputs");
  });

  test("an input the step has no variable for takes its default", () => {
    const { doc } = inlineCopyOfLibraryAlert(libraryRow(), [variable("${trigger.data.amount}")]);
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks friend!" });
  });

  test("an input with nothing to fill it is kept visible as {id} and named", () => {
    const row = libraryRow({ inputs: [{ id: "name", label: "Name", type: "text" }] });
    const { doc, unfilled } = inlineCopyOfLibraryAlert(row, [variable("${trigger.data.amount}")]);
    expect(unfilled).toEqual(["name"]);
    expect(doc.widgets.top?.settings).toEqual({ text: "Thanks {name}!" });
  });

  test("fills a reference to an input the alert does not declare", () => {
    const row = libraryRow({ inputs: [] });
    expect(inlineCopyOfLibraryAlert(row, [userName]).doc.widgets.top?.settings).toEqual({
      text: "Thanks ${trigger.data.user.name}!",
    });
    const unbound = inlineCopyOfLibraryAlert(row, []);
    expect(unbound.unfilled).toEqual(["name"]);
    expect(unbound.doc.widgets.top?.settings).toEqual({ text: "Thanks {name}!" });
  });
});

describe("inputVariableOptions", () => {
  test("offers each input as a {{id}} reference", () => {
    expect(
      inputVariableOptions([
        { id: "userName", label: "User name", type: "text" },
        { id: "amount", label: "", type: "number" },
      ])
    ).toEqual([
      { value: "{{userName}}", label: "User name", group: "Alert inputs", type: "string", description: undefined },
      { value: "{{amount}}", label: "amount", group: "Alert inputs", type: "number", description: undefined },
    ]);
  });
});

describe("libraryAlertOfStep", () => {
  test("turns each variable into an input named after it", () => {
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
    const doc = libraryAlertOfStep(step, available);
    expect(doc.inputs).toEqual([
      { id: "user", label: "User", type: "text" },
      { id: "amount", label: "Bits", type: "number" },
    ]);
    expect(doc.widgets.text?.settings).toEqual({ text: "{{user}} cheered {{amount}} \\{{bits}}" });
    expect(doc.widgets.count?.settings).toEqual({ value: { $input: "amount" } });
  });

  test("a copy started from it in a step with the same variables shows what the step showed", () => {
    const step = compositionOfLibraryAlert(
      libraryRow({ widgets: [entry("t", 0, { text: "Hi ${trigger.data.user}" })], inputs: [] })
    );
    const available = [variable("${trigger.data.user}")];
    const json = libraryJsonOf(libraryAlertOfStep(step, available));
    const copy = inlineCopyOfLibraryAlert(
      {
        widgets: JSON.parse(json.widgetsJson),
        layout: JSON.parse(json.layoutJson),
        behaviors: {},
        inputs: JSON.parse(json.inputsJson),
      },
      available
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
    expect(libraryAlertOfStep(step, []).inputs?.map((input) => input.id)).toEqual(["name", "name_2"]);
  });
});

describe("libraryPreviewInputs", () => {
  test("previews each input with its default, or its {id} where it has none", () => {
    expect(
      libraryPreviewInputs([
        { id: "name", label: "Name", type: "text", defaultValue: "friend" },
        { id: "amount", label: "Bits", type: "number" },
      ])
    ).toEqual({ name: "friend", amount: "{amount}" });
  });
});
