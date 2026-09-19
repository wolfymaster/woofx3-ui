import { describe, expect, test } from "bun:test";
import type { Widget } from "@/types";
import {
  alertLengthSeconds,
  centerOf,
  clampCenter,
  fitZoom,
  longestLayerId,
  newLayer,
  snapToCenter,
  withCenter,
  zoomIn,
  zoomOut,
} from "./alert-editor";

const CANVAS = { width: 1920, height: 1080 };

function widget(id: string, extra: Partial<Widget> = {}): Widget {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: "Text",
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    rotation: 0,
    opacity: 100,
    zIndex: 1,
    locked: false,
    visible: true,
    settings: {},
    ...extra,
  };
}

describe("centers", () => {
  test("round-trip between a center and the stored top-left", () => {
    const moved = withCenter(widget("a"), { x: 960, y: 540 });
    expect(moved.position).toEqual({ x: 860, y: 490 });
    expect(centerOf(moved)).toEqual({ x: 960, y: 540 });
  });

  test("keep a center on the canvas", () => {
    expect(clampCenter({ x: -40, y: 2000 }, CANVAS)).toEqual({ x: 0, y: 1080 });
  });
});

describe("snapToCenter", () => {
  test("pulls a near center onto both center lines", () => {
    expect(snapToCenter({ x: 975, y: 530 }, CANVAS, 20)).toEqual({
      center: { x: 960, y: 540 },
      onVertical: true,
      onHorizontal: true,
    });
  });

  test("leaves a far center alone", () => {
    expect(snapToCenter({ x: 1200, y: 540 }, CANVAS, 20)).toEqual({
      center: { x: 1200, y: 540 },
      onVertical: false,
      onHorizontal: true,
    });
  });
});

describe("zoom", () => {
  test("steps between the fixed levels, stopping at the ends", () => {
    expect(zoomIn(0.36)).toBe(0.5);
    expect(zoomOut(0.36)).toBe(0.3);
    expect(zoomIn(1)).toBe(1);
    expect(zoomOut(0.2)).toBe(0.2);
  });

  test("steps from a fit zoom that sits between levels", () => {
    expect(zoomIn(0.4)).toBe(0.5);
    expect(zoomOut(0.4)).toBe(0.36);
  });

  test("fits the canvas in a box", () => {
    expect(fitZoom({ width: 1008, height: 800 }, CANVAS, 24)).toBeCloseTo(0.5);
  });
});

describe("alert length", () => {
  test("is the longest layer's duration", () => {
    const widgets = [widget("a", { settings: { duration: 5 } }), widget("b", { settings: { duration: 8 } })];
    expect(alertLengthSeconds(widgets)).toBe(8);
    expect(longestLayerId(widgets)).toBe("b");
  });

  test("names no longest layer on a tie", () => {
    const widgets = [widget("a", { settings: { duration: 5 } }), widget("b", { settings: { duration: 5 } })];
    expect(longestLayerId(widgets)).toBeUndefined();
  });
});

describe("newLayer", () => {
  const text = { widgetId: "woofx3:widget:text", name: "Text", settings: [{ id: "align", defaultValue: "center" }] };

  test("starts a text layer centered, with the declared defaults and a length", () => {
    const layer = newLayer(text, [], CANVAS);
    expect(centerOf(layer)).toEqual({ x: 960, y: 540 });
    expect(layer.settings).toMatchObject({ align: "center", text: "New text", fontSize: 48, duration: 5 });
    expect(layer.id).toBe("w-1");
  });

  test("steps a repeated add off the layers already there, on a fresh id", () => {
    const first = newLayer(text, [], CANVAS);
    const second = newLayer(text, [first], CANVAS);
    expect(centerOf(second)).toEqual({ x: 1000, y: 580 });
    expect(second.id).not.toBe(first.id);
    expect(second.zIndex).toBe(first.zIndex + 1);
  });

  test("puts audio in the top right", () => {
    const layer = newLayer({ widgetId: "woofx3:widget:audio", name: "Audio", settings: [] }, [], CANVAS);
    expect(centerOf(layer)).toEqual({ x: 1780, y: 60 });
    expect(layer.settings.duration).toBe(3);
  });
});
