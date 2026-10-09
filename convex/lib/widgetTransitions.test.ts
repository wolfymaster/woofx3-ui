import { describe, expect, test } from "bun:test";
import { placementTransitions, readPlacementTransition, readWidgetTransitions } from "./widgetTransitions";

describe("readPlacementTransition", () => {
  test("reads what the engine accepts", () => {
    expect(readPlacementTransition({ type: "slide", durationMs: 400, direction: "left", easing: "linear" })).toEqual({
      type: "slide",
      durationMs: 400,
      direction: "left",
      easing: "linear",
    });
    expect(readPlacementTransition({ type: "typewriter", durationMs: 1200 })).toEqual({
      type: "typewriter",
      durationMs: 1200,
    });
  });

  test("drops anything the engine would refuse", () => {
    for (const value of [
      null,
      "fade",
      { type: "fade" },
      { type: "fade", durationMs: 10 },
      { type: "Fade", durationMs: 400 },
      { type: "fade", durationMs: 400, direction: "up" },
      { type: "fade", durationMs: 400, easing: "bouncy" },
      { type: "fade", durationMs: 400, delayMs: 1 },
    ]) {
      expect(readPlacementTransition(value)).toBeUndefined();
    }
  });
});

describe("placementTransitions", () => {
  test("holds only the transitions a placement has", () => {
    expect(placementTransitions({ transitionIn: { type: "fade", durationMs: 300 }, transitionOut: 7 })).toEqual({
      transitionIn: { type: "fade", durationMs: 300 },
    });
    expect(placementTransitions({})).toEqual({});
  });
});

describe("readWidgetTransitions", () => {
  test("reads a definition's declared types, dropping malformed and generic ones", () => {
    expect(
      readWidgetTransitions({
        transitions: [
          { id: "typewriter", label: "Typewriter" },
          { id: "wave" },
          { id: "fade", label: "Fade" },
          { label: "No id" },
          "letters",
        ],
      })
    ).toEqual([
      { id: "typewriter", label: "Typewriter" },
      { id: "wave", label: "wave" },
    ]);
    expect(readWidgetTransitions({})).toEqual([]);
    expect(readWidgetTransitions(null)).toEqual([]);
  });
});
