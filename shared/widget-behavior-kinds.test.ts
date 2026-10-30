import { describe, expect, it } from "bun:test";
import { BEHAVIOR_KIND_LABEL_MAX_LENGTH, MAX_DECLARED_KINDS, readWidgetBehaviorKinds } from "./widget-behavior-kinds";

describe("readWidgetBehaviorKinds", () => {
  it("reads the kinds a widget declares", () => {
    expect(
      readWidgetBehaviorKinds({
        transitions: [{ id: "typewriter", label: "Typewriter" }],
        effects: [{ id: "rainbow", label: "Rainbow" }],
      })
    ).toEqual({
      transitions: [{ id: "typewriter", label: "Typewriter" }],
      effects: [{ id: "rainbow", label: "Rainbow" }],
    });
  });

  it("reads no kinds from an engine that sends none, or anything that is not an object", () => {
    const none = { transitions: [], effects: [] };
    expect(readWidgetBehaviorKinds(undefined)).toEqual(none);
    expect(readWidgetBehaviorKinds(null)).toEqual(none);
    expect(readWidgetBehaviorKinds("typewriter")).toEqual(none);
    expect(readWidgetBehaviorKinds([{ id: "typewriter" }])).toEqual(none);
    expect(readWidgetBehaviorKinds({ transitions: "typewriter", effects: {} })).toEqual(none);
  });

  it("drops entries whose id the scene model refuses, and repeats", () => {
    expect(
      readWidgetBehaviorKinds({
        transitions: [
          { id: "Typewriter", label: "Upper" },
          { id: "type writer", label: "Space" },
          { id: 7, label: "Number" },
          null,
          "typewriter",
          { id: "typewriter", label: "First" },
          { id: "typewriter", label: "Second" },
        ],
        effects: [],
      }).transitions
    ).toEqual([{ id: "typewriter", label: "First" }]);
  });

  it("labels a kind by its id when the label is missing or blank, and trims and bounds it", () => {
    const long = "x".repeat(BEHAVIOR_KIND_LABEL_MAX_LENGTH + 10);
    expect(
      readWidgetBehaviorKinds({
        transitions: [
          { id: "a" },
          { id: "b", label: "  " },
          { id: "c", label: "  Spaced  " },
          { id: "d", label: long },
        ],
        effects: [],
      }).transitions
    ).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "b" },
      { id: "c", label: "Spaced" },
      { id: "d", label: "x".repeat(BEHAVIOR_KIND_LABEL_MAX_LENGTH) },
    ]);
  });

  it("keeps at most a bounded number of kinds per type", () => {
    const many = Array.from({ length: MAX_DECLARED_KINDS + 5 }, (_, i) => ({ id: `k${i}`, label: `K${i}` }));
    expect(readWidgetBehaviorKinds({ transitions: [], effects: many }).effects).toHaveLength(MAX_DECLARED_KINDS);
  });
});
