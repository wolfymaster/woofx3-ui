import { type CanvasSize, fitZoom, zoomIn, zoomOut } from "@woofx3/scene/editor";
import { Minus, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Room around the canvas when it is fitted to the stage area, clear of the zoom control. */
const FIT_PADDING = 32;
const ZOOM_CONTROL_ROOM = 56;

/**
 * A zoom kept by someone else (the composition editor, whose gestures and
 * shortcuts need it), in place of the area's own.
 */
/** The canvas a stage draws a composition on: the scene editor's and the alert editor's alike. */
export const CANVAS_STAGE_CLASS = "relative shrink-0 overflow-hidden shadow-lg ring-1 ring-border";

export interface StageZoom {
  zoom: number;
  /** Zoom follows the area's size rather than a level the user picked. */
  fit: boolean;
  /** The room the canvas has: the area less the zoom control. Fit follows it. */
  onMeasure: (size: CanvasSize) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
}

interface StageAreaProps {
  canvas: CanvasSize;
  /** Omitted, the area keeps the zoom itself. */
  zoomControl?: StageZoom;
  /** How the area claims its space: a grid cell needs nothing, a flex child needs `flex-1`. */
  className?: string;
  /** The canvas itself, drawn at the zoom the area settled on. */
  children: (zoom: number) => ReactNode;
}

/**
 * The scrollable area a canvas is edited in: dot grid behind it, the canvas
 * centered, and a zoom control that follows the area's size until the user
 * picks a level.
 *
 * Shared by the alert editor and the scene editor so both read as one surface.
 * It owns only the framing and the zoom; the canvas it is handed draws its own
 * background and decides what a press on it means, which is why an alert stage
 * and a scene canvas can sit in the same area without this knowing about either.
 */
export function StageArea({ canvas, zoomControl, className, children }: StageAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  // The room the canvas has, once measured; Fit follows it.
  const [room, setRoom] = useState<CanvasSize | null>(null);
  const fit = room === null ? 0.36 : fitZoom(room, canvas, FIT_PADDING);
  // Null follows Fit as the window resizes; a number is a zoom the user picked.
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const ownZoom: StageZoom = {
    zoom: chosenZoom ?? fit,
    fit: chosenZoom === null,
    onMeasure: setRoom,
    zoomIn: () => setChosenZoom(zoomIn(chosenZoom ?? fit)),
    zoomOut: () => setChosenZoom(zoomOut(chosenZoom ?? fit)),
    zoomToFit: () => setChosenZoom(null),
  };
  const control = zoomControl ?? ownZoom;
  const { zoom } = control;
  // The observer outlives renders, so it reaches the current control through a ref.
  const measureRef = useRef(control.onMeasure);
  measureRef.current = control.onMeasure;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      measureRef.current({ width, height: height - ZOOM_CONTROL_ROOM });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={areaRef}
      className={cn("relative min-h-0 overflow-auto", className)}
      style={{
        backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div
        className="flex min-h-full min-w-full items-center justify-center p-8 pb-20"
        style={{ width: "max-content" }}
      >
        {children(zoom)}
      </div>
      <div className="sticky bottom-4 left-0 flex justify-center">
        <div className="flex items-center gap-1 rounded-xl border bg-popover p-1 shadow-lg">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={control.zoomOut}
            aria-label="Zoom out"
            data-testid="button-zoom-out"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={control.zoomIn}
            aria-label="Zoom in"
            data-testid="button-zoom-in"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={control.zoomToFit}
            aria-pressed={control.fit}
            data-testid="button-fit"
          >
            Fit
          </Button>
        </div>
      </div>
    </div>
  );
}
