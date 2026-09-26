import { describe, expect, test } from "bun:test";
import type { Widget } from "@/types";
import { buildPreviewLayoutMessage, PREVIEW_LAYOUT_MESSAGE } from "./scene-preview-layout";

function widget(id: string, x: number, y: number, width: number, height: number): Widget {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: "Text",
    position: { x, y },
    size: { width, height },
    rotation: 0,
    opacity: 100,
    zIndex: 1,
    locked: false,
    visible: true,
    settings: { text: "hello" },
  };
}

describe("buildPreviewLayoutMessage", () => {
  test("flattens each widget to its id and box", () => {
    expect(buildPreviewLayoutMessage([widget("w1", 10, 20, 300, 200), widget("w2", 0, 0, 50, 60)])).toEqual({
      type: PREVIEW_LAYOUT_MESSAGE,
      widgets: [
        { id: "w1", x: 10, y: 20, width: 300, height: 200 },
        { id: "w2", x: 0, y: 0, width: 50, height: 60 },
      ],
    });
  });

  // The overlay hides every widget a layout leaves out, so an empty scene must
  // still send a message rather than nothing.
  test("sends an empty layout for a scene with no widgets", () => {
    expect(buildPreviewLayoutMessage([])).toEqual({ type: PREVIEW_LAYOUT_MESSAGE, widgets: [] });
  });
});
