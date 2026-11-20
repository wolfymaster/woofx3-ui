import type {
  CanvasSize,
  CommandResult,
  CompositionEditor,
  EditorState,
  GestureKind,
  Guide,
  NodeView,
  Point,
} from "@woofx3/scene/editor";
import { type PointerEvent, type RefObject, type SyntheticEvent, useCallback, useEffect, useMemo, useRef } from "react";
import type { StageZoom } from "@/components/common/stage-area";
import { createFrameCoalescer } from "@/lib/frame-coalescer";

/** A layer as the layers list shows it: the topmost node first. */
export interface NodeLayer {
  id: string;
  visible: boolean;
  locked: boolean;
  node: NodeView;
}

/** Stable while the editor is, so a memoized node keeps its identity as the stage re-renders. */
export interface StageGestures {
  /** Presses on `node`: selects it if it is not, then begins a gesture. Ignores non-primary presses. */
  begin(event: PointerEvent<HTMLElement>, node: NodeView, kind: GestureKind): void;
  continue(event: PointerEvent<HTMLElement>): void;
  end(event: PointerEvent<HTMLElement>): void;
  cancel(event: PointerEvent<HTMLElement>): void;
  select(id: string, additive: boolean): void;
}

export interface OverlayStageView {
  /** Attach to the scaled canvas element: its on-screen corner is where a gesture's points are measured from. */
  canvasRef: RefObject<HTMLDivElement>;
  /** The lines a gesture snapped to, in canvas coordinates: draw them at `1 / zoom` thickness. */
  guides: readonly Guide[];
  layers: NodeLayer[];
  /** Null until there is an editor to zoom. */
  zoomControl: StageZoom | null;
  gestures: StageGestures;
  deselect(): void;
  /** Deselects when the press landed on the element carrying the handler itself, not on a widget inside it. */
  deselectOnBackground(event: SyntheticEvent): void;
  /** Moves a layer to a row of the (top-first) layers list. */
  moveLayer(id: string, toIndex: number): void;
}

interface PointerUpdate {
  point: Point;
  shift: boolean;
  alt: boolean;
}

/**
 * The view glue both overlay stages (the scene canvas and the alert stage) share,
 * driven by a composition editor; each surface still draws its own nodes.
 *
 * One gesture runs at a time: its pointer is captured on the element it began on, so
 * moves and the release arrive there wherever the pointer goes, and events from any
 * other pointer are ignored. Moves reach the editor at most once per animation frame
 * (the editor works from where the gesture began, so a dropped point loses nothing);
 * the release flushes the last one and commits. A change the editor refuses goes to
 * `report`, which is the caller's to show.
 *
 * The coalescer is made again with the editor, which a saved editor replaces when its
 * document source changes: moves go to the editor the gesture began on.
 */
export function useOverlayStage(
  editor: CompositionEditor | null,
  state: EditorState | null,
  report: (result: CommandResult) => void
): OverlayStageView {
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const updates = useMemo(
    () => createFrameCoalescer<PointerUpdate>(({ point, shift, alt }) => editor?.gesture.update(point, { shift, alt })),
    [editor]
  );
  useEffect(() => () => updates.cancel(), [updates]);

  const beginGesture = useCallback(
    (event: PointerEvent<HTMLElement>, node: NodeView, kind: GestureKind) => {
      if (editor === null || !event.isPrimary || event.button !== 0) {
        return;
      }
      event.stopPropagation();
      if (!node.selected) {
        editor.dispatch("selection.select", { id: node.id });
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      editor.viewport.setOrigin(rect === undefined ? { x: 0, y: 0 } : { x: rect.left, y: rect.top });
      const began = editor.gesture.begin({
        kind,
        node: node.id,
        handle: kind === "resize" ? "se" : undefined,
        point: { x: event.clientX, y: event.clientY },
        pointer: event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse",
      });
      if (!began) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerId.current = event.pointerId;
    },
    [editor]
  );

  const continueGesture = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== event.pointerId) {
        return;
      }
      updates.push({ point: { x: event.clientX, y: event.clientY }, shift: event.shiftKey, alt: event.altKey });
    },
    [updates]
  );

  const endGesture = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (editor === null || pointerId.current !== event.pointerId) {
        return;
      }
      pointerId.current = null;
      // Commit the final position on release rather than a frame later.
      updates.flush();
      if (editor.getState().transient === null) {
        // Escape cancelled the gesture before the release.
        return;
      }
      const result = editor.gesture.end();
      if (!result.ok) {
        report(result);
      }
    },
    [editor, updates, report]
  );

  const cancelGesture = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (editor === null || pointerId.current !== event.pointerId) {
        return;
      }
      pointerId.current = null;
      updates.cancel();
      editor.gesture.cancel();
    },
    [editor, updates]
  );

  const select = useCallback(
    (id: string, additive: boolean) => editor?.dispatch("selection.select", { id, additive }),
    [editor]
  );
  const gestures = useMemo(
    (): StageGestures => ({
      begin: beginGesture,
      continue: continueGesture,
      end: endGesture,
      cancel: cancelGesture,
      select,
    }),
    [beginGesture, continueGesture, endGesture, cancelGesture, select]
  );
  const deselect = useCallback(() => editor?.dispatch("selection.clear"), [editor]);

  // Deselect on a press, not a click: a drag moves the widget out from under the cursor, so the
  // click that follows lands on their common ancestor, which is the background.
  const deselectOnBackground = useCallback(
    (event: SyntheticEvent) => {
      if (event.target === event.currentTarget) {
        deselect();
      }
    },
    [deselect]
  );

  const nodes = state?.view.nodes;
  const layers = useMemo(
    (): NodeLayer[] =>
      [...(nodes ?? [])]
        .reverse()
        .map((node) => ({ id: node.id, visible: node.placement.visible, locked: node.placement.locked, node })),
    [nodes]
  );
  const nodeCount = nodes?.length ?? 0;
  const moveLayer = useCallback(
    (id: string, toIndex: number) => {
      if (editor !== null) {
        report(editor.nodes.reorder(id, { index: nodeCount - 1 - toIndex }));
      }
    },
    [editor, nodeCount, report]
  );

  const zoom = state?.viewport.zoom ?? 1;
  const fit = state?.viewport.fit ?? true;
  const onMeasure = useCallback((size: CanvasSize) => editor?.viewport.setStage(size), [editor]);
  const zoomControl = useMemo(
    (): StageZoom | null =>
      editor === null
        ? null
        : {
            zoom,
            fit,
            onMeasure,
            zoomIn: () => editor.dispatch("view.zoomIn"),
            zoomOut: () => editor.dispatch("view.zoomOut"),
            zoomToFit: () => editor.dispatch("view.zoomFit"),
          },
    [editor, zoom, fit, onMeasure]
  );

  return {
    canvasRef,
    guides: state?.guides ?? [],
    layers,
    zoomControl,
    gestures,
    deselect,
    deselectOnBackground,
    moveLayer,
  };
}
