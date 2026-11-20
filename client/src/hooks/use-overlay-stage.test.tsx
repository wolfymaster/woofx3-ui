import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  type CommandResult,
  type CompositionEditor,
  createCompositionEditor,
  LocalDocumentSource,
  type NodeView,
} from "@woofx3/scene/editor";
import { PROFILES } from "@woofx3/scene/model";
import { type PointerEvent, useSyncExternalStore } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type OverlayStageView, useOverlayStage } from "./use-overlay-stage";

const placement = (x: number, z: string) => ({
  widget: "example:widget:clock",
  x,
  y: 100,
  width: 100,
  height: 100,
  visible: true,
  z,
  settings: {},
  name: "",
  rotation: 0,
  opacity: 1,
  locked: false,
  extra: {},
});

function newEditor() {
  const source = new LocalDocumentSource({
    layout: { width: 1920, height: 1080 },
    widgets: { a: placement(100, "a0"), b: placement(1000, "a1") },
    behaviors: {},
  });
  return { source, editor: createCompositionEditor({ source, profile: PROFILES.scene, catalog: [] }) };
}

interface PointerOverrides {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  isPrimary?: boolean;
  button?: number;
}

function pointer(overrides: PointerOverrides = {}) {
  const captured: number[] = [];
  const event = {
    pointerId: 1,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    isPrimary: true,
    button: 0,
    shiftKey: false,
    altKey: false,
    stopPropagation: () => undefined,
    currentTarget: { setPointerCapture: (id: number) => captured.push(id) },
    ...overrides,
  };
  return { event: event as unknown as PointerEvent<HTMLElement>, captured };
}

/** Frames the test fires by hand, so a move is delivered when the test says the frame arrived. */
const frames: Array<() => void> = [];

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback: () => void) => frames.push(callback)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    frames[handle - 1] = () => undefined;
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  frames.length = 0;
});

async function mount(editor: CompositionEditor, report: (result: CommandResult) => void) {
  const probe: { view: OverlayStageView | null; renderer: ReactTestRenderer | null } = { view: null, renderer: null };
  function Probe() {
    const state = useSyncExternalStore(editor.subscribe, editor.getState);
    probe.view = useOverlayStage(editor, state, report);
    return null;
  }
  await act(async () => {
    probe.renderer = create(<Probe />);
  });
  return probe as { view: OverlayStageView; renderer: ReactTestRenderer };
}

function nodeOf(editor: CompositionEditor, id: string): NodeView {
  const node = editor.getState().view.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) {
    throw new Error(`no node ${id}`);
  }
  return node;
}

describe("useOverlayStage gestures", () => {
  it("drags a node: press selects and captures, the release commits one change", async () => {
    const { editor, source } = newEditor();
    const reported: CommandResult[] = [];
    const probe = await mount(editor, (result) => reported.push(result));
    const { gestures } = probe.view;

    const down = pointer({ clientX: 150, clientY: 150 });
    await act(async () => gestures.begin(down.event, nodeOf(editor, "a"), "move"));
    expect(down.captured).toEqual([1]);
    expect(editor.getState().selection.primary).toBe("a");

    await act(async () => gestures.continue(pointer({ clientX: 250, clientY: 170 }).event));
    expect(source.getDocument().widgets.a?.x).toBe(100);
    await act(async () => gestures.end(pointer({ clientX: 250, clientY: 170 }).event));

    // Screen pixels become canvas pixels at the editor's zoom.
    const { zoom } = editor.getState().viewport;
    expect(source.getDocument().widgets.a?.x).toBeCloseTo(100 + 100 / zoom, 0);
    expect(reported).toEqual([]);
    expect(editor.getState().transient).toBeNull();
  });

  it("coalesces moves to the latest point of the frame", async () => {
    const { editor } = newEditor();
    const probe = await mount(editor, () => undefined);
    await act(async () =>
      probe.view.gestures.begin(pointer({ clientX: 150, clientY: 150 }).event, nodeOf(editor, "a"), "move")
    );

    await act(async () => {
      probe.view.gestures.continue(pointer({ clientX: 160, clientY: 150 }).event);
      probe.view.gestures.continue(pointer({ clientX: 300, clientY: 150 }).event);
    });
    expect(frames).toHaveLength(1);
    await act(async () => frames[0]?.());

    const { zoom } = editor.getState().viewport;
    expect(editor.getState().transient?.boxes.a?.x).toBeCloseTo(100 + 150 / zoom, 0);
  });

  it("runs one gesture at a time: other pointers and non-primary presses are ignored", async () => {
    const { editor, source } = newEditor();
    const probe = await mount(editor, () => undefined);
    const { gestures } = probe.view;

    const secondary = pointer({ button: 2 });
    await act(async () => gestures.begin(secondary.event, nodeOf(editor, "a"), "move"));
    expect(secondary.captured).toEqual([]);
    expect(editor.getState().transient).toBeNull();

    await act(async () => gestures.begin(pointer({ clientX: 150, clientY: 150 }).event, nodeOf(editor, "a"), "move"));
    await act(async () => gestures.continue(pointer({ pointerId: 2, clientX: 900, clientY: 900 }).event));
    await act(async () => gestures.end(pointer({ pointerId: 2, clientX: 900, clientY: 900 }).event));
    expect(editor.getState().transient).not.toBeNull();

    await act(async () => gestures.end(pointer({ clientX: 150, clientY: 150 }).event));
    expect(source.getDocument().widgets.a?.x).toBe(100);
  });

  it("drops a cancelled gesture without committing", async () => {
    const { editor, source } = newEditor();
    const probe = await mount(editor, () => undefined);
    await act(async () =>
      probe.view.gestures.begin(pointer({ clientX: 150, clientY: 150 }).event, nodeOf(editor, "a"), "move")
    );
    await act(async () => probe.view.gestures.continue(pointer({ clientX: 350, clientY: 150 }).event));
    await act(async () => probe.view.gestures.cancel(pointer().event));

    expect(editor.getState().transient).toBeNull();
    expect(source.getDocument().widgets.a?.x).toBe(100);
  });

  it("reports a gesture the editor refuses to commit", async () => {
    const { editor } = newEditor();
    const refusal: CommandResult = { ok: false, detail: "no room" };
    const refusing = { ...editor, gesture: { ...editor.gesture, end: () => refusal } } as CompositionEditor;
    const reported: CommandResult[] = [];
    const probe = await mount(refusing, (result) => reported.push(result));

    await act(async () =>
      probe.view.gestures.begin(pointer({ clientX: 150, clientY: 150 }).event, nodeOf(editor, "a"), "move")
    );
    await act(async () => probe.view.gestures.end(pointer({ clientX: 150, clientY: 150 }).event));

    expect(reported).toEqual([refusal]);
  });
});

describe("useOverlayStage layers", () => {
  it("lists the top of the stack first, and maps a list row back to a stack index", async () => {
    const { editor, source } = newEditor();
    const probe = await mount(editor, () => undefined);
    expect(probe.view.layers.map((layer) => layer.id)).toEqual(["b", "a"]);

    await act(async () => probe.view.moveLayer("a", 0));
    expect(
      Object.entries(source.getDocument().widgets)
        .sort(([, left], [, right]) => left.z.localeCompare(right.z))
        .map(([id]) => id)
    ).toEqual(["b", "a"]);
  });

  it("reports a reorder the editor refuses", async () => {
    const { editor } = newEditor();
    const reported: CommandResult[] = [];
    const probe = await mount(editor, (result) => reported.push(result));
    await act(async () => probe.view.moveLayer("missing", 0));
    expect(reported).toHaveLength(1);
    expect(reported[0]?.ok).toBe(false);
  });
});

describe("useOverlayStage deselect and zoom", () => {
  it("deselects only for a press on the element itself", async () => {
    const { editor } = newEditor();
    const probe = await mount(editor, () => undefined);
    editor.dispatch("selection.select", { id: "a" });
    const background = {};

    await act(async () => probe.view.deselectOnBackground({ target: {}, currentTarget: background } as never));
    expect(editor.getState().selection.primary).toBe("a");
    await act(async () => probe.view.deselectOnBackground({ target: background, currentTarget: background } as never));
    expect(editor.getState().selection.primary).toBeNull();
  });

  it("wires the zoom control to the editor's view commands", async () => {
    const { editor } = newEditor();
    const probe = await mount(editor, () => undefined);
    const before = editor.getState().viewport.zoom;
    await act(async () => probe.view.zoomControl?.zoomIn());
    expect(editor.getState().viewport.zoom).toBeGreaterThan(before);
  });
});
