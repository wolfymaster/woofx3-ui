import { describe, expect, it } from "bun:test";
import { SceneSyncClient } from "@woofx3/api/scene-editor/client";
import { diffDocuments } from "@/lib/scene-document";
import { canvasEdit, canvasOfDocument, documentOfCanvas } from "@/lib/scene-document-widgets";
import { TestClock, TestSceneServer } from "@/lib/scene-sync-test-server";
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
    // Only the background changed.
    expect(diffDocuments(doc, edited).every((op) => op.p[0] === "layout" && op.p[1] === "backgroundColor")).toBe(true);
  });
});

describe("canvasEdit with the sync client", () => {
  async function editors() {
    const clock = new TestClock();
    const server = new TestSceneServer(clock, documentOfCanvas(canvas, null));
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
    return { server, mine, theirs, settle };
  }

  it("sends a canvas change as an edit of the version it names", async () => {
    const { server, mine, settle } = await editors();
    const result = mine.edit(
      "draft",
      canvasEdit((current) => ({
        ...current,
        widgets: current.widgets.map((w) => (w.id === "a" ? { ...w, position: { x: 500, y: 600 } } : w)),
      }))
    );
    expect(result).toEqual({ ok: true });
    await settle();
    expect(server.state.docs.draft.widgets.a?.x).toBe(500);
    expect(server.state.docs.published.widgets.a?.x).toBe(10);
  });

  it("applies the updater to the client's current document, keeping another editor's change", async () => {
    const { server, mine, theirs, settle } = await editors();
    theirs.edit(
      "draft",
      canvasEdit((current) => ({ ...current, backgroundColor: "#ff0000" }))
    );
    await settle();
    expect(mine.getState().local?.draft.layout.backgroundColor).toBe("#ff0000");
    mine.edit(
      "draft",
      canvasEdit((current) => ({ ...current, widgets: current.widgets.filter((w) => w.id !== "b") }))
    );
    await settle();
    expect(server.state.docs.draft.layout.backgroundColor).toBe("#ff0000");
    expect(Object.keys(server.state.docs.draft.widgets)).toEqual(["a"]);
    expect(theirs.getState().local?.draft).toEqual(server.state.docs.draft);
  });

  it("adds and restacks widgets in shapes the server accepts", async () => {
    const { server, mine, settle } = await editors();
    mine.edit(
      "published",
      canvasEdit((current) => ({
        ...current,
        widgets: [...current.widgets.map((w) => ({ ...w, zIndex: w.id === "a" ? 5 : w.zIndex })), widget("c", 2)],
      }))
    );
    await settle();
    expect(mine.hasPending()).toBe(false);
    expect(canvasOfDocument(server.state.docs.published).widgets.map((w) => w.id)).toEqual(["b", "c", "a"]);
  });
});
