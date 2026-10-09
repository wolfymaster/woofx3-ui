import { describe, expect, test } from "bun:test";
import {
  NO_TRANSITION,
  pickerValue,
  previewKeyframes,
  transitionTypeOptions,
  withTransitionDuration,
  withTransitionEasing,
  withTransitionType,
} from "./widget-transition-editor";

const typewriter = [{ id: "typewriter", label: "Typewriter" }];

describe("transitionTypeOptions", () => {
  test("offers none, the generic types, then the widget's own", () => {
    const options = transitionTypeOptions(typewriter);
    expect(options[0]).toEqual({ value: NO_TRANSITION, label: "None", group: "none" });
    expect(options.filter((o) => o.group === "generic").map((o) => o.value)).toEqual([
      "fade",
      "slide",
      "zoom",
      "bounce",
      "spin",
      "pop",
      "blur",
    ]);
    expect(options.at(-1)).toEqual({ value: "typewriter", label: "Typewriter", group: "widget" });
  });
});

describe("withTransitionType", () => {
  test("starts a transition at the default duration", () => {
    expect(withTransitionType(undefined, "fade")).toEqual({ type: "fade", durationMs: 500 });
  });

  test("keeps duration and easing, and a direction only from slide to slide", () => {
    const slide = { type: "slide", durationMs: 800, easing: "linear" as const, direction: "left" as const };
    expect(withTransitionType(slide, "slide")).toEqual(slide);
    expect(withTransitionType(slide, "zoom")).toEqual({ type: "zoom", durationMs: 800, easing: "linear" });
  });

  test("clears the transition for none", () => {
    expect(withTransitionType({ type: "fade", durationMs: 300 }, NO_TRANSITION)).toBeUndefined();
  });
});

describe("withTransitionDuration", () => {
  test("holds the duration to what the engine accepts", () => {
    const fade = { type: "fade", durationMs: 300 };
    expect(withTransitionDuration(fade, 10).durationMs).toBe(50);
    expect(withTransitionDuration(fade, 99_999).durationMs).toBe(10_000);
    expect(withTransitionDuration(fade, 412.6).durationMs).toBe(413);
    expect(withTransitionDuration(fade, Number.NaN)).toBe(fade);
  });
});

describe("withTransitionEasing", () => {
  test("drops the easing to return to the default", () => {
    expect(withTransitionEasing({ type: "fade", durationMs: 300, easing: "linear" }, undefined)).toEqual({
      type: "fade",
      durationMs: 300,
    });
  });
});

describe("pickerValue", () => {
  test("reads a type the widget no longer declares as none", () => {
    expect(pickerValue({ type: "typewriter", durationMs: 300 }, [])).toBe(NO_TRANSITION);
    expect(pickerValue({ type: "typewriter", durationMs: 300 }, typewriter)).toBe("typewriter");
    expect(pickerValue(undefined, typewriter)).toBe(NO_TRANSITION);
  });
});

describe("previewKeyframes", () => {
  test("plays a generic type and leaves the widget's own to the widget", () => {
    expect(previewKeyframes({ type: "fade", durationMs: 300 }, "out")?.map((f) => f.opacity)).toEqual([1, 0]);
    expect(previewKeyframes({ type: "typewriter", durationMs: 300 }, "in")).toBeNull();
  });
});
