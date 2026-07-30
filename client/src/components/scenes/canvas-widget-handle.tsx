import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Widget } from "@/types";

interface CanvasWidgetHandleProps {
  widget: Widget;
  isSelected: boolean;
  scale: number;
  onSelect: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (width: number, height: number) => void;
}

/**
 * Drag/resize/select handle for a widget's placement on the canvas. Deliberately
 * has no fill — the real widget pixels come from LiveScenePreview's iframe
 * underneath; this is purely an interaction surface plus an outline/label so the
 * user can see and grab what they're positioning.
 */
export function CanvasWidgetHandle({ widget, isSelected, scale, onSelect, onMove, onResize }: CanvasWidgetHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();
      setIsDragging(true);
      startPos.current = { x: e.clientX, y: e.clientY };
    },
    [onSelect]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsResizing(true);
      startPos.current = { x: e.clientX, y: e.clientY };
      startSize.current = { width: widget.size.width, height: widget.size.height };
    },
    [widget.size]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = (e.clientX - startPos.current.x) / scale;
        const dy = (e.clientY - startPos.current.y) / scale;
        onMove(dx, dy);
        startPos.current = { x: e.clientX, y: e.clientY };
      }
      if (isResizing) {
        const dw = (e.clientX - startPos.current.x) / scale;
        const dh = (e.clientY - startPos.current.y) / scale;
        onResize(Math.max(50, startSize.current.width + dw), Math.max(50, startSize.current.height + dh));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, scale, onMove, onResize]);

  const showLabel = isHovered || isSelected;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven drag surface on the scaled canvas
    <div
      className={cn(
        "absolute cursor-move group border-2 border-dashed border-transparent hover:border-white/40",
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
      onMouseDown={handleMouseDown}
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
        // biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven resize handle
        <div
          className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
}
