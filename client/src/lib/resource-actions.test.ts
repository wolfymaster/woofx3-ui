import { describe, expect, test } from "bun:test";
import { resourceActionStep } from "@/lib/resource-actions";
import type { ActionPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as ActionPreset["icon"];

function preset(overrides: Partial<ActionPreset>): ActionPreset {
  return {
    id: "row-1",
    name: "Increment counter",
    description: "",
    icon,
    category: "General",
    color: "#888",
    ...overrides,
  };
}

const increment = preset({
  canonicalRef: "woofx3:action:counter.increment",
  handlerType: "function",
  functionCall: "woofx3:function:counter.increment",
  config: { fields: [{ id: "target", label: "Counter", type: "resource_ref", resourceKind: "counter" }] },
});

describe("resourceActionStep", () => {
  test("runs the catalog's action, aimed at the chosen instance", () => {
    const step = resourceActionStep([increment], "woofx3", "counter.increment", { target: "woofx3:counter:deaths" });
    expect(step).toMatchObject({
      action: "function",
      function: "woofx3:function:counter.increment",
      $ref: "woofx3:action:counter.increment",
      parameters: { target: "woofx3:counter:deaths" },
    });
  });

  test("says which module to update when the action is missing", () => {
    expect(() => resourceActionStep([], "woofx3", "counter.increment", {})).toThrow("update the woofx3 module");
  });
});
