import { describe, expect, test } from "bun:test";
import { resourceTriggers } from "@/lib/resource-triggers";
import type { ConfigField, TriggerPreset } from "@/lib/workflow-presets";

const icon = (() => null) as unknown as TriggerPreset["icon"];

function preset(name: string, event: string | undefined, fields: Partial<ConfigField>[]): TriggerPreset {
  return {
    id: name,
    name,
    description: "",
    icon,
    category: "General",
    color: "#888",
    event,
    config: { fields: fields as ConfigField[] },
  };
}

const timerField = { id: "timer", label: "Timer", type: "resource_ref", resourceKind: "timer" } as const;

describe("resourceTriggers", () => {
  test("the triggers with a resource_ref field for the kind, by name, with that field", () => {
    const presets = [
      preset("Timer started", "timer.started", [timerField]),
      preset("Timer ended", "timer.ended", [timerField]),
      preset("Counter changed", "counter.changed", [
        { id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" },
      ]),
      preset("Cheer", "channel.cheer", [{ id: "bits", label: "Bits", type: "number" }]),
    ];
    expect(resourceTriggers(presets, "timer").map(({ preset, fieldId }) => [preset.name, fieldId])).toEqual([
      ["Timer ended", "timer"],
      ["Timer started", "timer"],
    ]);
  });

  test("a trigger with no event has nothing to fire on and is left out", () => {
    expect(resourceTriggers([preset("Manual", undefined, [timerField])], "timer")).toEqual([]);
  });
});
