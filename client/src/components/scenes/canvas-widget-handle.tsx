import { memo, useEffect, useRef, useState } from "react";
import { createFrameCoalescer } from "@/lib/frame-coalescer";
import { cn } from "@/lib/utils";
import type { Widget } from "@/types";

const MIN_WIDGET_SIZE = 50;

interface CanvasWidgetHandleProps {
  widget: Widget;
  isSelected: boolean;
  scale: number;
  onSelect: (widgetId: string) => void;
  onMove: (widgetId: string, x: number, y: number) => void;
  onResize: (widgetId: string, width: number, height: number) => void;
}

interface Gesture {
  mode: "move" | "resize";
  pointerId: number;
  pointerStart: { x: number; y: number };
  widgetStart: { x: number; y: number; width: number; height: number };
}

type GestureUpdate = { mode: "move"; x: number; y: number } | { mode: "resize"; width: number; height: number };

/**
 * Drag/resize/select handle for a widget's placement on the canvas. Deliberately
 * has no fill — the real widget pixels come from LiveScenePreview's iframe
 * underneath; this is purely an interaction surface plus an outline/label so the
 * user can see and grab what they're positioning.
 *
 * A gesture captures the pointer on the element it started on, so moves and the
 * release reach this handle wherever the pointer goes, without window listeners.
 * Positions are computed from where the gesture started rather than summed from
 * per-event deltas, which lets updates be coalesced to one per animation frame
 * without losing movement.
 *
 * Memoized: the canvas passes callbacks that take a widget id and stay stable,
 * so dragging one widget re-renders only that widget's handle.
 */
export const CanvasWidgetHandle = memo(function CanvasWidgetHandle({
  widget,
  isSelected,
  scale,
  onSelect,
  onMove,
  onResize,
}: CanvasWidgetHandleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  // The coalescer outlives renders, so it reaches the current props through a ref.
  const latest = useRef({ widgetId: widget.id, onMove, onResize });
  latest.current = { widgetId: widget.id, onMove, onResize };

  const [updates] = useState(() =>
    createFrameCoalescer<GestureUpdate>((update) => {
      const { widgetId, onMove: move, onResize: resize } = latest.current;
      if (update.mode === "move") {
        move(widgetId, update.x, update.y);
      } else {
        resize(widgetId, update.width, update.height);
      }
    })
  );

  useEffect(() => {
    return () => updates.cancel();
  }, [updates]);

  const beginGesture = (e: React.PointerEvent<HTMLDivElement>, mode: Gesture["mode"]) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      mode,
      pointerId: e.pointerId,
      pointerStart: { x: e.clientX, y: e.clientY },
      widgetStart: {
        x: widget.position.x,
        y: widget.position.y,
        width: widget.size.width,
        height: widget.size.height,
      },
    };
  };

  const isPrimaryPress = (e: React.PointerEvent) => e.isPrimary && e.button === 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPrimaryPress(e)) {
      return;
    }
    onSelect(widget.id);
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
    const current = gesture.current;
    if (!current || current.pointerId !== e.pointerId) {
      return;
    }
    const dx = (e.clientX - current.pointerStart.x) / scale;
    const dy = (e.clientY - current.pointerStart.y) / scale;
    if (current.mode === "move") {
      updates.push({ mode: "move", x: current.widgetStart.x + dx, y: current.widgetStart.y + dy });
    } else {
      updates.push({
        mode: "resize",
        width: Math.max(MIN_WIDGET_SIZE, current.widgetStart.width + dx),
        height: Math.max(MIN_WIDGET_SIZE, current.widgetStart.height + dy),
      });
    }
  };

  const endGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== e.pointerId) {
      return;
    }
    gesture.current = null;
    // Commit the final position on release rather than a frame later.
    updates.flush();
  };

  const showLabel = isHovered || isSelected;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven drag surface on the scaled canvas
    <div
      className={cn(
        "absolute cursor-move touch-none group border-2 border-dashed border-transparent hover:border-white/40",
        isSelected && "!border-solid !border-primary"
      )}
      style={{
        left: widget.position.x,
        top: widget.position.y,
        width: widget.size.width,
        height: widget.size.height,
        opacity: widget.opacity / 100,
        // +10 keeps every handle above LiveScenePreview's iframe (z-index 1) and the
        // fallback layer (z-index 0) regardless of the widget's own stacking order.
        zIndex: widget.zIndex + 10,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      // The canvas deselects on mousedown, which the browser still fires after
      // pointerdown; a press on a widget must not reach it.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid={`canvas-widget-${widget.id}`}
    >
      {showLabel && (
        <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground whitespace-nowrap">
          {widget.name}
        </span>
      )}

      {isSelected && (
        <div
          className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-se-resize"
          onPointerDown={handleResizePointerDown}
        />
      )}
    </div>
  );
});
