import { describe, expect, it } from "bun:test";
import { createCompositionEditor, LocalDocumentSource } from "@woofx3/scene/editor";
import { PROFILES } from "@woofx3/scene/model";
import { type EditorKeyEvent, isEditorKeyTarget, type KeyTargetLike, sendKeyToEditor } from "@/lib/editor-keys";

function element(tagName: string, inside: string[] = [], isContentEditable = false): KeyTargetLike {
  return {
    tagName,
    isContentEditable,
    closest: (selector: string) =>
      inside.some((match) => selector.split(",").some((part) => part.trim() === match)) ? {} : null,
  };
}

describe("isEditorKeyTarget", () => {
  it("takes keys pressed with nothing focused, or on the canvas", () => {
    expect(isEditorKeyTarget(null)).toBe(true);
    expect(isEditorKeyTarget(element("BODY"))).toBe(true);
    expect(isEditorKeyTarget(element("DIV"))).toBe(true);
  });

  it("leaves keys to text fields", () => {
    expect(isEditorKeyTarget(element("INPUT"))).toBe(false);
    expect(isEditorKeyTarget(element("textarea"))).toBe(false);
    expect(isEditorKeyTarget(element("SELECT"))).toBe(false);
    expect(isEditorKeyTarget(element("DIV", [], true))).toBe(false);
  });

  it("leaves keys to dialogs, menus and sortable grips", () => {
    expect(isEditorKeyTarget(element("BUTTON", ['[role="dialog"]']))).toBe(false);
    expect(isEditorKeyTarget(element("DIV", ['[role="menu"]']))).toBe(false);
    expect(isEditorKeyTarget(element("BUTTON", ['[aria-roledescription="sortable"]']))).toBe(false);
  });
});

describe("sendKeyToEditor", () => {
  function editorWithOneWidget() {
    const source = new LocalDocumentSource({
      layout: { width: 1920, height: 1080 },
      widgets: {
        a: {
          widget: "example:widget:clock",
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          visible: true,
          z: "a0",
          settings: {},
          name: "",
          rotation: 0,
          opacity: 1,
          locked: false,
          extra: {},
        },
      },
      behaviors: {},
    });
    return { source, editor: createCompositionEditor({ source, profile: PROFILES.scene, catalog: [] }) };
  }

  function press(key: string, target: KeyTargetLike | null = null): EditorKeyEvent {
    return { key, target, defaultPrevented: false, isComposing: false };
  }

  it("lets the browser have an arrow when nothing is selected, so the page scrolls", () => {
    const { editor, source } = editorWithOneWidget();
    expect(sendKeyToEditor(editor, press("ArrowDown"))).toBe(false);
    editor.dispatch("selection.select", { id: "a" });
    expect(sendKeyToEditor(editor, press("ArrowDown"))).toBe(true);
    expect(source.getDocument().widgets.a?.y).toBe(101);
  });

  it("lets the browser have a key the editor refuses while read-only", () => {
    const { editor, source } = editorWithOneWidget();
    editor.dispatch("selection.select", { id: "a" });
    source.setReadOnly(true);
    expect(sendKeyToEditor(editor, press("Delete"))).toBe(false);
    expect(Object.keys(source.getDocument().widgets)).toEqual(["a"]);
  });

  it("never sees a key typed into a field, or one already handled", () => {
    const { editor, source } = editorWithOneWidget();
    editor.dispatch("selection.select", { id: "a" });
    expect(sendKeyToEditor(editor, press("Delete", element("INPUT")))).toBe(false);
    expect(sendKeyToEditor(editor, { ...press("Delete"), defaultPrevented: true })).toBe(false);
    expect(Object.keys(source.getDocument().widgets)).toEqual(["a"]);
  });
});
