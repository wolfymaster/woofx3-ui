import type { NodeView } from "@woofx3/scene/editor";
import { Lock } from "lucide-react";
import { memo, useState } from "react";
import type { StageGestures } from "@/hooks/use-overlay-stage";
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
  gestures: StageGestures;
  /** The canvas's scale on screen. */
  zoom: number;
  /** The node's place in the stack, bottom first. */
  rank: number;
  /** Other editors that have this widget selected. */
  remote?: RemoteSelection[];
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
 * The gesture lifecycle (pointer capture, per-frame updates, the commit on release)
 * is the stage's: see useOverlayStage.
 *
 * Memoized: a node keeps its identity in the editor's state while unchanged, so
 * dragging one widget re-renders only that widget's handle.
 */
export const CanvasWidgetHandle = memo(function CanvasWidgetHandle({
  node,
  gestures,
  zoom,
  rank,
  remote,
}: CanvasWidgetHandleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isPrimaryPress = (e: React.PointerEvent) => e.isPrimary && e.button === 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPrimaryPress(e)) {
      return;
    }
    if (e.shiftKey) {
      e.stopPropagation();
      gestures.select(node.id, true);
      return;
    }
    gestures.begin(e, node, "move");
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    gestures.begin(e, node, "resize");
  };

  const { box, placement } = node;
  const showLabel = isHovered || node.selected;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven drag surface on the scaled canvas
    <div
      className={cn(
        "absolute touch-none group border-2 border-dashed border-transparent hover:border-white/40",
        placement.locked ? "cursor-default" : "cursor-move",
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
      // Pointer events from the resize dot bubble here too, so one handler serves both gestures.
      onPointerMove={gestures.continue}
      onPointerUp={gestures.end}
      onPointerCancel={gestures.cancel}
      // The canvas deselects on mousedown, which the browser still fires after
      // pointerdown; a press on a widget must not reach it.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`canvas-widget-${node.id}`}
    >
      {showLabel && (
        <span className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground whitespace-nowrap">
          {placement.locked && <Lock className="h-2.5 w-2.5" aria-label="Locked" />}
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

      {node.selected && !placement.locked && (
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
