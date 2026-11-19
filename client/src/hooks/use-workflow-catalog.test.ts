import { describe, expect, test } from "bun:test";
import { BUILTIN_MODULE_LABEL } from "@shared/module-labels";
import {
  type CatalogActionRow,
  type CatalogTriggerRow,
  toActionPreset,
  toTriggerPreset,
} from "@/hooks/use-workflow-catalog";

const base = {
  id: "row",
  name: "A row",
  description: "What it does",
  category: "",
  color: "",
  icon: "",
};

const configFields = [
  {
    id: "choice",
    label: "Choice",
    type: "select",
    options: [{ value: "a", label: "A" }],
    source: { kind: "internal", request: { event: "list-choices" } },
  },
];

const trigger: CatalogTriggerRow = {
  ...base,
  event: "twitch:cheer",
  sentence: "  ",
  emits: [{ path: "amount" }, { path: "" }],
  configFields,
  canonicalRef: "mod:trigger:alerts",
};

const action: CatalogActionRow = {
  ...base,
  functionCall: "alert",
  sentence: "  ",
  returns: [{ path: "next" }, { path: "" }],
  configFields,
  canonicalRef: "mod:action:alert",
};

describe("catalog normalisers", () => {
  test("a blank sentence is no sentence at all", () => {
    expect(toTriggerPreset(trigger).sentence).toBeUndefined();
    expect(toActionPreset(action).sentence).toBeUndefined();
  });

  test("the two kinds keep their different moduleLabel fallbacks", () => {
    expect(toTriggerPreset(trigger).source).toBeUndefined();
    expect(toActionPreset(action).source).toBe(BUILTIN_MODULE_LABEL);
  });

  test("config fields carry the module and the field-options owner from the canonical id", () => {
    const fields = toTriggerPreset(trigger).config?.fields ?? [];
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: "choice",
      options: [{ value: "a", label: "A" }],
      source: {
        kind: "internal",
        reference: { moduleId: "mod", declaration: "trigger", declarationId: "alerts", fieldId: "choice" },
      },
    });

    const actionFields = toActionPreset(action).config?.fields ?? [];
    expect(actionFields[0].source).toMatchObject({
      reference: { moduleId: "mod", declaration: "action", declarationId: "alert", fieldId: "choice" },
    });
  });

  test("emits and returns keep only data-shape entries with a path", () => {
    expect(toTriggerPreset(trigger).emits).toEqual([{ path: "amount" }]);
    expect(toActionPreset(action).config?.outputs).toEqual([{ path: "next" }]);
  });
});
