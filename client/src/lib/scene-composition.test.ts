import { describe, expect, it } from "bun:test";
import { SceneSyncClient } from "@woofx3/api/scene-editor/client";
import { diffDocuments } from "@woofx3/api/scene-editor/document";
import { createCompositionEditor, LocalDocumentSource, offeredKinds, SyncDocumentSource } from "@woofx3/scene/editor";
import { PROFILES, stackOrder } from "@woofx3/scene/model";
import type { SceneWidgetCatalogRow } from "@/engine/types";
import {
  canvasSettingsOf,
  catalogOfRows,
  compositionOfStoredScene,
  editorColor,
  remoteSelectionsOf,
  type StoredScene,
  storedSceneJson,
  storedWidgetsOf,
} from "@/lib/scene-composition";
import { TestClock, TestSceneServer } from "@/lib/scene-sync-test-server";
import type { Widget } from "@/types";

function widget(id: string, zIndex: number, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    widgetCanonicalId: "example:widget:clock",
    name: `Clock ${id}`,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 80 },
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
    settings: { format: id },
    ...overrides,
  };
}

const scene: StoredScene = {
  width: 1920,
  height: 1080,
  backgroundColor: "transparent",
  widgets: [widget("a", 0), widget("b", 1)],
};

function row(widgetId: string, overrides: Partial<SceneWidgetCatalogRow> = {}): SceneWidgetCatalogRow {
  return {
    widgetId,
    name: widgetId,
    settings: [{ id: "format", label: "Format", type: "text", defaultValue: "HH:mm" }],
    taxonomy: ["time"],
    ...overrides,
  } as unknown as SceneWidgetCatalogRow;
}

const catalog = catalogOfRows([
  row("example:widget:clock"),
  row("woofx3:widget:alert", { settings: [], hostsSurface: "alert", surfaces: ["scene"] }),
  row("woofx3:widget:image", { surfaces: ["alert"] }),
]);

describe("compositionOfStoredScene + storedWidgetsOf", () => {
  it("round-trips a cached scene", () => {
    const doc = compositionOfStoredScene(scene);
    expect(storedWidgetsOf(doc)).toEqual(scene.widgets);
    expect(canvasSettingsOf(doc)).toEqual({ width: 1920, height: 1080, backgroundColor: "transparent" });
  });

  it("stacks by zIndex, ties by array order", () => {
    const doc = compositionOfStoredScene({ ...scene, widgets: [widget("a", 2), widget("b", 1), widget("c", 1)] });
    expect(stackOrder(doc)).toEqual(["b", "c", "a"]);
  });

  it("gives what the cache leaves out the defaults a placement takes", () => {
    const sparse = { ...widget("a", 0), visible: undefined, settings: undefined } as unknown as Widget;
    const placement = compositionOfStoredScene({ ...scene, widgets: [sparse] }).widgets.a;
    expect(placement?.visible).toBe(true);
    expect(placement?.settings).toEqual({});
    expect(placement?.extra).toEqual({});
  });

  it("stores a composition as updateScene takes it", () => {
    const json = storedSceneJson(compositionOfStoredScene(scene));
    expect(JSON.parse(json.widgetsJson)).toEqual(scene.widgets);
    expect(JSON.parse(json.layoutJson)).toEqual({ width: 1920, height: 1080, backgroundColor: "transparent" });
  });
});

describe("the scene settings", () => {
  it("change one layout key through the editor, keeping the rest, and undo as one change", () => {
    const doc = { ...compositionOfStoredScene(scene), layout: { width: 1920, height: 1080, grid: 8 } };
    const source = new LocalDocumentSource(doc);
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog });
    expect(editor.canvas.patch({ backgroundColor: "#000000" })).toEqual({ ok: true });
    expect(source.getDocument().layout).toEqual({ width: 1920, height: 1080, grid: 8, backgroundColor: "#000000" });
    expect(canvasSettingsOf(source.getDocument()).backgroundColor).toBe("#000000");
    editor.history.undo();
    expect(source.getDocument().layout).toEqual({ width: 1920, height: 1080, grid: 8 });
  });

  it("refuse a size that is not a positive number, saying why", () => {
    const source = new LocalDocumentSource(compositionOfStoredScene(scene));
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog });
    expect(editor.canvas.patch({ width: 0 })).toEqual({ ok: false, detail: "a canvas width is a positive number" });
    expect(editor.canvas.patch({ height: Number.NaN }).ok).toBe(false);
    expect(editor.canvas.patch({ width: 1280 })).toEqual({ ok: true });
  });
});

describe("catalogOfRows", () => {
  it("keeps what the editor reads of a row", () => {
    expect(catalog[1]).toEqual({
      widgetId: "woofx3:widget:alert",
      name: "woofx3:widget:alert",
      settings: [],
      surfaces: ["scene"],
      hostsSurface: "alert",
    });
    expect(Object.hasOwn(catalog[0] as object, "surfaces")).toBe(false);
  });

  it("carries the behavior kinds a row declares, so the editor offers them", () => {
    const behaviorKinds = { transitions: [{ id: "typewriter", label: "Typewriter" }], effects: [] };
    const [text] = catalogOfRows([row("woofx3:widget:text", { behaviorKinds })]);
    expect(text?.behaviorKinds).toEqual(behaviorKinds);
    expect(offeredKinds(text, "transition").map((offered) => offered.kind)).toContain("typewriter");
    expect(Object.hasOwn(catalog[0] as object, "behaviorKinds")).toBe(false);
  });
});

describe("remoteSelectionsOf", () => {
  it("groups other editors by the widget each has selected", () => {
    const selections = remoteSelectionsOf([
      { id: "p1", name: "Ada", selection: "a" },
      { id: "p2", name: "Bo", selection: "a" },
      { id: "p3", name: "Cy", selection: null },
    ]);
    expect(selections).toEqual({
      a: [
        { name: "Ada", color: editorColor("p1") },
        { name: "Bo", color: editorColor("p2") },
      ],
    });
  });

  it("gives an editor the same colour every time", () => {
    expect(editorColor("p1")).toBe(editorColor("p1"));
    expect(editorColor("p1")).toMatch(/^hsl\(\d+ 75% 45%\)$/);
  });
});

describe("the Save-button editor", () => {
  it("edits the cached scene in memory and stores it whole", () => {
    const source = new LocalDocumentSource(compositionOfStoredScene(scene));
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog });
    editor.viewport.setZoom(1);
    expect(editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } })).toBe(true);
    editor.gesture.update({ x: 100, y: 50 }, { alt: true });
    expect(editor.gesture.end()).toEqual({ ok: true });
    expect(editor.nodes.reorder("a", { index: 1 })).toEqual({ ok: true });
    const stored = storedWidgetsOf(source.getDocument());
    expect(stored.map((w) => [w.id, w.zIndex, w.position])).toEqual([
      ["b", 0, { x: 10, y: 20 }],
      ["a", 1, { x: 110, y: 70 }],
    ]);
  });

  it("offers only the widgets a scene takes, and names alert areas", () => {
    const source = new LocalDocumentSource(compositionOfStoredScene({ ...scene, widgets: [] }));
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog });
    expect(editor.getState().palette.map((entry) => entry.widgetId)).toEqual([
      "example:widget:clock",
      "woofx3:widget:alert",
    ]);
    const added = editor.nodes.add("woofx3:widget:alert");
    expect(added.ok).toBe(true);
    const id = added.ok ? added.id : "";
    expect(source.getDocument().widgets[id]?.settings.name).toBe("default");
    expect(editor.nodes.add("woofx3:widget:image").ok).toBe(false);
  });
});

describe("the editor over the sync client", () => {
  async function editors() {
    const clock = new TestClock();
    const server = new TestSceneServer(clock, compositionOfStoredScene(scene));
    const make = (id: string) => {
      const client = new SceneSyncClient({
        open: async () => "ws://engine/scene/s1/edit?protocol=2",
        connect: server.connect,
        clock,
        newClientId: () => id,
        name: id,
      });
      client.start();
      return client;
    };
    const mine = make("mine");
    const theirs = make("theirs");
    await server.run();
    const settle = async () => {
      for (let i = 0; i < 5; i++) {
        await clock.advance(200);
        await server.run();
      }
    };
    const editorOf = (client: SceneSyncClient, version: "draft" | "published") => {
      const editor = createCompositionEditor({
        source: new SyncDocumentSource({ client, version }),
        profile: PROFILES.scene,
        catalog,
      });
      editor.viewport.setZoom(1);
      return editor;
    };
    return { server, mine, theirs, settle, editorOf };
  }

  it("commits a drag as one edit of the version it edits", async () => {
    const { server, mine, settle, editorOf } = await editors();
    const editor = editorOf(mine, "draft");
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } });
    editor.gesture.update({ x: 200, y: 0 }, { alt: true });
    editor.gesture.update({ x: 490, y: 580 }, { alt: true });
    expect(editor.gesture.end()).toEqual({ ok: true });
    await settle();
    expect(server.state.docs.draft.widgets.a?.x).toBe(500);
    expect(server.state.docs.draft.widgets.a?.y).toBe(600);
    expect(server.state.docs.published.widgets.a?.x).toBe(10);
  });

  it("restacks by changing only the moved widget's key", async () => {
    const { server, mine, settle, editorOf } = await editors();
    const before = structuredClone(server.state.docs.published);
    editorOf(mine, "published").nodes.reorder("a", { index: 1 });
    await settle();
    expect(stackOrder(server.state.docs.published)).toEqual(["b", "a"]);
    expect(diffDocuments(before, server.state.docs.published).map((op) => op.p.join("."))).toEqual(["widgets.a.z"]);
  });

  it("keeps another editor's change made in between", async () => {
    const { server, mine, theirs, settle, editorOf } = await editors();
    expect(editorOf(theirs, "draft").canvas.patch({ backgroundColor: "#ff0000" })).toEqual({ ok: true });
    await settle();
    const editor = editorOf(mine, "draft");
    expect(editor.getState().doc?.layout.backgroundColor).toBe("#ff0000");
    editor.dispatch("selection.select", { id: "b" });
    expect(editor.handleKey({ key: "Delete" })).toBe(true);
    await settle();
    expect(server.state.docs.draft.layout.backgroundColor).toBe("#ff0000");
    expect(Object.keys(server.state.docs.draft.widgets)).toEqual(["a"]);
    expect(theirs.getState().local?.draft).toEqual(server.state.docs.draft);
  });

  it("undoes only this editor's change", async () => {
    const { server, mine, theirs, settle, editorOf } = await editors();
    const editor = editorOf(mine, "draft");
    expect(editor.nodes.patch("a", { settings: { format: "mm:ss" } })).toEqual({ ok: true });
    await settle();
    editorOf(theirs, "draft").nodes.patch("b", { visible: false });
    await settle();
    expect(editor.handleKey({ key: "z", ctrlKey: true })).toBe(true);
    await settle();
    expect(server.state.docs.draft.widgets.a?.settings.format).toBe("a");
    expect(server.state.docs.draft.widgets.b?.visible).toBe(false);
  });

  it("holds the draft still while a publish is pending, saying why", async () => {
    const { server, mine, settle, editorOf } = await editors();
    const editor = editorOf(mine, "draft");
    expect(editor.canvas.patch({ width: 1280 })).toEqual({ ok: true });
    expect(mine.publish()).toBe(true);
    expect(editor.getState().capabilities.readOnlyReason).toBe("the draft is being published");
    expect(editor.canvas.patch({ width: 640 })).toEqual({ ok: false, detail: "the draft is being published" });
    expect(editorOf(mine, "published").getState().capabilities.readOnly).toBe(false);
    await settle();
    expect(editor.getState().capabilities.readOnlyReason).toBeNull();
    expect(server.state.docs.published.layout.width).toBe(1280);
  });
});
