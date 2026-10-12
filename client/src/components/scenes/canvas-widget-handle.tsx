import type { CommandResult, CompositionEditor, GestureKind, NodeView, Point } from "@woofx3/scene/editor";
import { memo, useEffect, useRef, useState } from "react";
import { createFrameCoalescer } from "@/lib/frame-coalescer";
import type { RemoteSelection } from "@/lib/scene-composition";
import { cn } from "@/lib/utils";

/**
 * On-screen size of the selected widget's corner handle, and of the press area
 * around it. The handle lives inside the scaled canvas, so both are divided by
 * the zoom to stay this size at any zoom.
 */
const HANDLE_DOT = 12;
const HANDLE_HIT = 24;

interface CanvasWidgetHandleProps {
  node: NodeView;
  editor: CompositionEditor;
  /** The canvas's scale on screen. */
  zoom: number;
  /** The node's place in the stack, bottom first. */
  rank: number;
  /** Other editors that have this widget selected. */
  remote?: RemoteSelection[];
  /** Where the canvas's top-left corner is on screen, read when a gesture starts. */
  canvasOrigin: () => Point;
  /** Told when a gesture's change was refused. */
  onRefused: (result: CommandResult) => void;
}

interface PointerUpdate {
  point: Point;
  shift: boolean;
  alt: boolean;
}

/**
 * Drag/resize/select handle for a placement on the canvas. Deliberately has no
 * fill — the real widget pixels come from LiveScenePreview's iframe underneath;
 * this is purely an interaction surface plus an outline/label so the user can
 * see and grab what they're positioning.
 *
 * The geometry is the composition editor's: a press begins an editor gesture,
 * pointer moves update it (snapping, aspect, the minimum size), and the release
 * commits it as one change. The handle draws the node's box as the editor
 * reports it, mid-gesture included.
 *
 * A gesture captures the pointer on the element it started on, so moves and the
 * release reach this handle wherever the pointer goes, without window listeners.
 * Updates are coalesced to one per animation frame; the editor works from where
 * the gesture started, so a dropped intermediate point loses nothing.
 *
 * Memoized: a node keeps its identity in the editor's state while unchanged, so
 * dragging one widget re-renders only that widget's handle.
 */
export const CanvasWidgetHandle = memo(function CanvasWidgetHandle({
  node,
  editor,
  zoom,
  rank,
  remote,
  canvasOrigin,
  onRefused,
}: CanvasWidgetHandleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const pointerId = useRef<number | null>(null);

  const [updates] = useState(() =>
    createFrameCoalescer<PointerUpdate>(({ point, shift, alt }) => editor.gesture.update(point, { shift, alt }))
  );

  useEffect(() => {
    return () => updates.cancel();
  }, [updates]);

  const isPrimaryPress = (e: React.PointerEvent) => e.isPrimary && e.button === 0;

  const beginGesture = (e: React.PointerEvent<HTMLDivElement>, kind: GestureKind) => {
    e.stopPropagation();
    editor.viewport.setOrigin(canvasOrigin());
    const began = editor.gesture.begin({
      kind,
      node: node.id,
      handle: kind === "resize" ? "se" : undefined,
      point: { x: e.clientX, y: e.clientY },
      pointer: e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse",
    });
    if (!began) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerId.current = e.pointerId;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPrimaryPress(e)) {
      return;
    }
    if (e.shiftKey) {
      e.stopPropagation();
      editor.dispatch("selection.select", { id: node.id, additive: true });
      return;
    }
    if (!node.selected) {
      editor.dispatch("selection.select", { id: node.id });
    }
    beginGesture(e, "move");
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPrimaryPress(e)) {
      return;
    }
    beginGesture(e, "resize");
  };

  // Pointer events from the resize dot bubble here too, so one handler serves
  // both gestures.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId) {
      return;
    }
    updates.push({ point: { x: e.clientX, y: e.clientY }, shift: e.shiftKey, alt: e.altKey });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId) {
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
      onRefused(result);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId) {
      return;
    }
    pointerId.current = null;
    updates.cancel();
    editor.gesture.cancel();
  };

  const { box, placement } = node;
  const showLabel = isHovered || node.selected;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven drag surface on the scaled canvas
    <div
      className={cn(
        "absolute cursor-move touch-none group border-2 border-dashed border-transparent hover:border-white/40",
        node.selected && "!border-solid !border-primary",
        // Hidden on stream, but still here to be placed.
        !placement.visible &&
          "border-white/30 bg-[repeating-linear-gradient(45deg,transparent_0_6px,rgba(255,255,255,0.08)_6px_12px)]"
      )}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: box.rotation === 0 ? undefined : `rotate(${box.rotation}deg)`,
        opacity: placement.opacity,
        // +10 keeps every handle above LiveScenePreview's iframe (z-index 1) and the
        // fallback layer (z-index 0) regardless of the widget's own stacking order.
        zIndex: rank + 10,
        // Another editor's selection, in its colour, outside this editor's own.
        boxShadow: remote?.[0] ? `0 0 0 2px ${remote[0].color}` : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      // The canvas deselects on mousedown, which the browser still fires after
      // pointerdown; a press on a widget must not reach it.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`canvas-widget-${node.id}`}
    >
      {showLabel && (
        <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground whitespace-nowrap">
          {placement.name}
        </span>
      )}

      {remote && remote.length > 0 && (
        <span className="absolute -top-5 right-0 flex gap-1" data-testid={`canvas-widget-${node.id}-editors`}>
          {remote.map((peer) => (
            <span
              key={`${peer.name}-${peer.color}`}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
              style={{ backgroundColor: peer.color }}
            >
              {peer.name || "Someone"}
            </span>
          ))}
        </span>
      )}

      {node.selected && (
        <div
          className="absolute flex cursor-se-resize items-center justify-center"
          style={{
            right: -HANDLE_HIT / 2 / zoom,
            bottom: -HANDLE_HIT / 2 / zoom,
            width: HANDLE_HIT / zoom,
            height: HANDLE_HIT / zoom,
          }}
          onPointerDown={handleResizePointerDown}
          data-testid={`canvas-widget-${node.id}-resize`}
        >
          <span className="rounded-full bg-primary" style={{ width: HANDLE_DOT / zoom, height: HANDLE_DOT / zoom }} />
        </div>
      )}
    </div>
  );
});
