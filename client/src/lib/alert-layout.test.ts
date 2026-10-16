import { describe, expect, it } from "bun:test";
import { createCompositionEditor, LocalDocumentSource, textBoxHeight } from "@woofx3/scene/editor";
import { type CompositionDocument, keyBetween, PROFILES, stackOrder } from "@woofx3/scene/model";
import {
  ALERT_COMPOSITION_CAPABILITY,
  alertCompositionOf,
  alertLayoutChanged,
  alertLayoutShapeFor,
  compositionOfLegacyAlert,
  DEFAULT_ALERT_CANVAS,
  isLegacyAlertLayout,
  legacyAlertLayoutOf,
  readAlertComposition,
  storedAlertLayout,
} from "./alert-layout";

const nameOf = (id: string) => (id === "woofx3:widget:text" ? "Text" : id);

const MODULE_LAYOUT = {
  width: 1280,
  height: 720,
  widgets: [
    {
      id: "message",
      widgetCanonicalId: "woofx3:widget:text",
      position: { x: 16, y: 608 },
      size: { width: 1248, height: 96 },
      settings: { text: "hi" },
    },
  ],
};

function placement(widget: string, z: string, overrides: Partial<CompositionDocument["widgets"][string]> = {}) {
  return {
    widget,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    visible: true,
    z,
    settings: {},
    name: widget,
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

describe("compositionOfLegacyAlert", () => {
  it("fills the editor-only fields of a module-authored layout", () => {
    const { doc, skipped } = compositionOfLegacyAlert(MODULE_LAYOUT);
    expect(skipped).toEqual([]);
    expect(doc.layout).toEqual({ width: 1280, height: 720 });
    expect(doc.behaviors).toEqual({});
    expect(doc.widgets.message).toEqual({
      widget: "woofx3:widget:text",
      x: 16,
      y: 608,
      width: 1248,
      height: 96,
      visible: true,
      z: expect.any(String),
      settings: { text: "hi" },
      name: "",
      rotation: 0,
      opacity: 1,
      locked: false,
      extra: {},
    });
  });

  it("stacks the list's widgets in array order, bottom first", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 1920,
      height: 1080,
      widgets: ["c", "a", "b"].map((id) => ({ id, widgetCanonicalId: "x" })),
    });
    expect(stackOrder(doc)).toEqual(["c", "a", "b"]);
  });

  it("keeps the fields this dashboard writes into each entry", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 1920,
      height: 1080,
      widgets: [
        {
          id: "a",
          widgetCanonicalId: "x",
          name: "Banner",
          rotation: 15,
          opacity: 0.5,
          locked: true,
          visible: false,
          zIndex: 9,
        },
      ],
    });
    expect(doc.widgets.a).toMatchObject({ name: "Banner", rotation: 15, opacity: 0.5, locked: true, visible: false });
  });

  it("skips and reports entries it cannot key by id", () => {
    const { doc, skipped, indexOf } = compositionOfLegacyAlert({
      width: 1920,
      height: 1080,
      widgets: [{ id: "a", widgetCanonicalId: "x" }, "junk", { widgetCanonicalId: "y" }, { id: "a" }],
    });
    expect(Object.keys(doc.widgets)).toEqual(["a"]);
    expect(indexOf).toEqual({ a: 0 });
    expect(skipped.map((skip) => skip.index)).toEqual([1, 2, 3]);
  });
});

describe("alertCompositionOf", () => {
  it("reads both shapes and refuses anything else", () => {
    expect(isLegacyAlertLayout(MODULE_LAYOUT)).toBe(true);
    const composition = {
      layout: { width: 1920, height: 1080 },
      widgets: { a: placement("x", keyBetween(null, null)) },
    };
    expect(isLegacyAlertLayout(composition)).toBe(false);
    expect(alertCompositionOf(composition)).toEqual({ ...composition, behaviors: {} });
    expect(alertCompositionOf(MODULE_LAYOUT)?.widgets.message?.widget).toBe("woofx3:widget:text");
    expect(alertCompositionOf("nope")).toBeNull();
    expect(alertCompositionOf(undefined)).toBeNull();
  });
});

describe("readAlertComposition", () => {
  it("starts an empty alert on the default canvas", () => {
    expect(readAlertComposition(undefined, nameOf)).toEqual({
      layout: { ...DEFAULT_ALERT_CANVAS },
      widgets: {},
      behaviors: {},
    });
  });

  it("names unnamed widgets from the catalog and keeps stored names", () => {
    const doc = readAlertComposition(
      {
        width: 1920,
        height: 1080,
        widgets: [
          { id: "a", widgetCanonicalId: "woofx3:widget:text" },
          { id: "b", widgetCanonicalId: "woofx3:widget:text", name: "Headline" },
        ],
      },
      nameOf
    );
    expect(doc.widgets.a?.name).toBe("Text");
    expect(doc.widgets.b?.name).toBe("Headline");
  });

  it("gives a canvas without a usable size the default one, keeping its other keys", () => {
    const doc = readAlertComposition({ width: 0, backgroundColor: "#000", widgets: [] }, nameOf);
    expect(doc.layout).toEqual({ ...DEFAULT_ALERT_CANVAS, backgroundColor: "#000" });
  });
});

describe("writing a layout", () => {
  const doc: CompositionDocument = {
    layout: { width: 1920, height: 1080, backgroundColor: "#000" },
    widgets: {
      top: placement("woofx3:widget:image", "a2", { name: "Image", x: 10, y: 20, width: 640, height: 360 }),
      bottom: placement("woofx3:widget:text", "a1", { name: "Text", settings: { text: "hi" } }),
    },
    behaviors: {
      fade: {
        type: "transition",
        kind: "fade",
        target: "top",
        order: "a0",
        timing: { anchor: "enter", offsetMs: 0, durationMs: 300, easing: "ease-out" },
        params: { phase: "in" },
      },
    },
  };

  it("writes the list shape bottom first, without behaviors", () => {
    const written = legacyAlertLayoutOf(doc);
    expect(written).toEqual({
      width: 1920,
      height: 1080,
      backgroundColor: "#000",
      widgets: [
        {
          id: "bottom",
          widgetCanonicalId: "woofx3:widget:text",
          name: "Text",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 200 },
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          settings: { text: "hi" },
        },
        {
          id: "top",
          widgetCanonicalId: "woofx3:widget:image",
          name: "Image",
          position: { x: 10, y: 20 },
          size: { width: 640, height: 360 },
          rotation: 0,
          opacity: 1,
          zIndex: 2,
          locked: false,
          visible: true,
          settings: {},
        },
      ],
    });
    expect("behaviors" in written).toBe(false);
  });

  it("reads back what it writes in the list shape, behaviors aside", () => {
    const back = readAlertComposition(storedAlertLayout(doc, "list"), nameOf);
    expect(stackOrder(back)).toEqual(["bottom", "top"]);
    expect(back.behaviors).toEqual({});
    const { z: _topZ, ...top } = back.widgets.top ?? placement("", "");
    const { z: _wasZ, ...wasTop } = doc.widgets.top ?? placement("", "");
    expect(top).toEqual(wasTop);
  });

  it("writes the composition shape whole, as a copy", () => {
    const written = storedAlertLayout(doc, "composition");
    expect(written).toEqual(doc);
    expect(written).not.toBe(doc);
    expect(readAlertComposition(written, nameOf)).toEqual(doc);
  });

  it("writes a composition only for an engine that says it plays one", () => {
    expect(ALERT_COMPOSITION_CAPABILITY).toBe("alerts.compositionLayout");
    expect(alertLayoutShapeFor("supported")).toBe("composition");
    expect(alertLayoutShapeFor("unsupported")).toBe("list");
    expect(alertLayoutShapeFor("checking")).toBe("list");
    expect(alertLayoutShapeFor("unknown")).toBe("list");
  });
});

describe("the alert editor over a stored layout", () => {
  const catalog = [
    {
      widgetId: "woofx3:widget:text",
      name: "Text",
      settings: [{ id: "align", defaultValue: "center" }],
      surfaces: ["alert"],
    },
    { widgetId: "woofx3:widget:video", name: "Video", settings: [], surfaces: ["alert"] },
    { widgetId: "woofx3:widget:audio", name: "Audio", settings: [], surfaces: ["alert"] },
    { widgetId: "acme:widget:clock", name: "Clock", settings: [], surfaces: ["scene"] },
  ];

  function open(raw: unknown) {
    const seed = readAlertComposition(raw, nameOf);
    const editor = createCompositionEditor({ source: new LocalDocumentSource(seed), profile: PROFILES.alert, catalog });
    const doc = () => editor.getState().doc as CompositionDocument;
    return { seed, editor, doc };
  }

  it("is unchanged until something is edited, and changed after", () => {
    const { seed, editor, doc } = open(MODULE_LAYOUT);
    expect(alertLayoutChanged(seed, doc())).toBe(false);
    editor.nodes.patch("message", { settings: { duration: 3 } });
    expect(alertLayoutChanged(seed, doc())).toBe(true);
  });

  it("offers only alert widgets", () => {
    const { editor } = open(undefined);
    expect(editor.getState().palette.map((row) => row.widgetId)).not.toContain("acme:widget:clock");
  });

  it("starts a text layer centred, with its declared defaults and a length", () => {
    const { editor, doc } = open(undefined);
    const added = editor.nodes.add("woofx3:widget:text");
    expect(added.ok).toBe(true);
    const id = added.ok ? added.id : "";
    const text = doc().widgets[id];
    expect(text?.settings).toMatchObject({ align: "center", text: "New text", fontSize: 48, duration: 5 });
    expect((text?.x ?? 0) + (text?.width ?? 0) / 2).toBe(960);
    expect(editor.getState().selection.primary).toBe(id);
  });

  it("puts audio in the top right", () => {
    const { editor, doc } = open(undefined);
    const added = editor.nodes.add("woofx3:widget:audio");
    const audio = doc().widgets[added.ok ? added.id : ""];
    expect(audio?.settings.duration).toBe(3);
    expect((audio?.x ?? 0) + (audio?.width ?? 0) / 2).toBe(1780);
  });

  it("grows a Text layer's box with its text, about its centre", () => {
    const { editor, doc } = open(MODULE_LAYOUT);
    const before = doc().widgets.message;
    editor.nodes.patch("message", { settings: { text: "one\ntwo\nthree" } });
    const after = doc().widgets.message;
    expect(after?.height).toBe(textBoxHeight(48, "one\ntwo\nthree"));
    expect((after?.y ?? 0) + (after?.height ?? 0) / 2).toBeCloseTo((before?.y ?? 0) + (before?.height ?? 0) / 2, 0);
  });

  it("keeps a media layer's height when only its width is set", () => {
    const { editor, doc } = open({
      width: 1920,
      height: 1080,
      widgets: [
        {
          id: "v",
          widgetCanonicalId: "woofx3:widget:video",
          position: { x: 0, y: 0 },
          size: { width: 640, height: 360 },
        },
      ],
    });
    editor.nodes.resize("v", { width: 1280 });
    expect(doc().widgets.v).toMatchObject({ width: 1280, height: 360 });
  });

  it("restacks by changing one layer, and writes the new order as the list", () => {
    const { editor, doc } = open({
      width: 1920,
      height: 1080,
      widgets: ["a", "b", "c"].map((id) => ({ id, widgetCanonicalId: "woofx3:widget:text" })),
    });
    const before = doc();
    editor.nodes.reorder("a", { index: 2 });
    const after = doc();
    expect(after.widgets.b?.z).toBe(before.widgets.b?.z);
    expect(after.widgets.c?.z).toBe(before.widgets.c?.z);
    expect(legacyAlertLayoutOf(after).widgets.map((entry) => (entry as { id: string }).id)).toEqual(["b", "c", "a"]);
  });

  it("keeps a moved centre on the canvas", () => {
    const { editor, doc } = open(MODULE_LAYOUT);
    editor.nodes.moveCenter("message", { x: -40, y: 2000 });
    const moved = doc().widgets.message;
    expect((moved?.x ?? 0) + (moved?.width ?? 0) / 2).toBe(0);
    expect((moved?.y ?? 0) + (moved?.height ?? 0) / 2).toBe(720);
  });
});
