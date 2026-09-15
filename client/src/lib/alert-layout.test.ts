import { describe, expect, it } from "bun:test";
import { DEFAULT_ALERT_CANVAS, readAlertLayout, writeAlertLayout } from "./alert-layout";

const nameOf = (id: string) => (id === "woofx3:widget:text" ? "Text" : id);

describe("readAlertLayout", () => {
  it("fills the editor-only fields of a module-authored layout", () => {
    const layout = readAlertLayout(
      {
        width: 1280,
        height: 720,
        widgets: [
          {
            id: "message",
            widgetCanonicalId: "woofx3:widget:text",
            position: { x: 16, y: 908 },
            size: { width: 1888, height: 156 },
            settings: { text: "hi" },
          },
        ],
      },
      nameOf
    );
    expect(layout.width).toBe(1280);
    expect(layout.height).toBe(720);
    expect(layout.widgets).toEqual([
      {
        id: "message",
        widgetCanonicalId: "woofx3:widget:text",
        name: "Text",
        position: { x: 16, y: 908 },
        size: { width: 1888, height: 156 },
        rotation: 0,
        opacity: 100,
        zIndex: 1,
        locked: false,
        visible: true,
        settings: { text: "hi" },
      },
    ]);
  });

  it("starts an empty layout on the default canvas", () => {
    expect(readAlertLayout(undefined, nameOf)).toEqual({ ...DEFAULT_ALERT_CANVAS, widgets: [] });
  });

  it("stacks stored widgets in array order", () => {
    const layout = readAlertLayout(
      {
        widgets: [
          { id: "a", widgetCanonicalId: "x" },
          { id: "b", widgetCanonicalId: "y" },
        ],
      },
      nameOf
    );
    expect(layout.widgets.map((w) => w.zIndex)).toEqual([1, 2]);
  });
});

describe("writeAlertLayout", () => {
  it("stores widgets in stacking order", () => {
    const layout = readAlertLayout(
      {
        widgets: [
          { id: "a", widgetCanonicalId: "x" },
          { id: "b", widgetCanonicalId: "y" },
        ],
      },
      nameOf
    );
    const [a, b] = layout.widgets;
    if (!a || !b) {
      throw new Error("expected two widgets");
    }
    const written = writeAlertLayout({ ...layout, widgets: [{ ...a, zIndex: 3 }, b] });
    expect(written.widgets.map((w) => w.id)).toEqual(["b", "a"]);
  });
});
