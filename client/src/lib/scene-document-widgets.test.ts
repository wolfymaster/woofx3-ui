import { describe, expect, it } from "bun:test";
import { diffDocuments } from "@/lib/scene-document";
import { canvasOfDocument, documentOfCanvas } from "@/lib/scene-document-widgets";
import type { Widget } from "@/types";

function widget(id: string, zIndex: number, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: `Text ${id}`,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    settings: { text: id },
    ...overrides,
  };
}

const canvas = { width: 1920, height: 1080, backgroundColor: "transparent", widgets: [widget("a", 0), widget("b", 1)] };

describe("documentOfCanvas + canvasOfDocument", () => {
  it("round-trips the editor's canvas", () => {
    expect(canvasOfDocument(documentOfCanvas(canvas, null))).toEqual(canvas);
  });

  it("stacks by zIndex, and a restack changes only stacking keys", () => {
    const doc = documentOfCanvas(canvas, null);
    const restacked = documentOfCanvas({ ...canvas, widgets: [widget("a", 2), widget("b", 1)] }, doc);
    expect(canvasOfDocument(restacked).widgets.map((w) => w.id)).toEqual(["b", "a"]);
    expect(diffDocuments(doc, restacked).every((op) => op.p[2] === "z")).toBe(true);
  });

  it("keeps what the editor does not show from the document it read", () => {
    const doc = documentOfCanvas(canvas, null);
    doc.widgets.a!.extra = { futureField: 1 };
    doc.layout.grid = 8;
    const edited = documentOfCanvas({ ...canvas, backgroundColor: "#000" }, doc);
    expect(edited.widgets.a!.extra).toEqual({ futureField: 1 });
    expect(edited.layout).toEqual({ grid: 8, width: 1920, height: 1080, backgroundColor: "#000" });
    // Only the background changed (as a text splice).
    expect(diffDocuments(doc, edited).every((op) => op.p[0] === "layout" && op.p[1] === "backgroundColor")).toBe(true);
  });
});
