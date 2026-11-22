import { describe, expect, test } from "bun:test";
import { THEME_FIELD_TYPE } from "@convex/lib/widgetThemes";
import type { FieldDescriptor } from "@/components/common/configuration-form";
import { configFieldRenderers } from "@/components/common/field-renderers";

// Mirrors the lookup order in ConfigurationForm.renderField: source kind, then
// field type, then the plain type (with "asset" sharing the media picker).
function resolveRenderer(field: FieldDescriptor) {
  const sourceKind = (field as { source?: { kind?: unknown } }).source?.kind;
  const own =
    (typeof sourceKind === "string" ? configFieldRenderers[`source:${sourceKind}`] : undefined) ??
    configFieldRenderers[`field:${field.type}`];
  return own ?? configFieldRenderers[field.type === "asset" ? "media" : field.type];
}

function field(type: string, source?: { kind: string }): FieldDescriptor {
  return { id: "f", label: "F", type, source } as unknown as FieldDescriptor;
}

describe("configFieldRenderers", () => {
  const cases: Array<[string, FieldDescriptor]> = [
    ["media", field("media")],
    ["asset", field("asset")],
    ["resource_ref", field("resource_ref")],
    ["field:layout", field("layout")],
    ["field:button", field("button")],
    ["field:theme", field(THEME_FIELD_TYPE)],
    ["source:alertWidgets", field("select", { kind: "alertWidgets" })],
    ["source:scenes", field("select", { kind: "scenes" })],
    ["source:scenePlacements", field("select", { kind: "scenePlacements" })],
    ["source:databaseColumns", field("select", { kind: "databaseColumns" })],
  ];

  test.each(cases)("resolves a renderer for %s", (_name, f) => {
    expect(typeof resolveRenderer(f)).toBe("function");
  });

  test("covers every registered key", () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys(configFieldRenderers).sort());
  });

  test("an unregistered plain type has no renderer", () => {
    expect(resolveRenderer(field("string"))).toBeUndefined();
  });
});
