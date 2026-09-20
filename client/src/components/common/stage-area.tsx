import { Minus, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type CanvasSize, fitZoom, zoomIn, zoomOut } from "@/lib/alert-editor";
import { cn } from "@/lib/utils";

/** Room around the canvas when it is fitted to the stage area, clear of the zoom control. */
const FIT_PADDING = 32;
const ZOOM_CONTROL_ROOM = 56;

interface StageAreaProps {
  canvas: CanvasSize;
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
export function StageArea({ canvas, className, children }: StageAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.36);
  // Null follows Fit as the window resizes; a number is a zoom the user picked.
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const zoom = chosenZoom ?? fit;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFit(fitZoom({ width, height: height - ZOOM_CONTROL_ROOM }, canvas, FIT_PADDING));
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [canvas]);

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
            onClick={() => setChosenZoom(zoomOut(zoom))}
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
            onClick={() => setChosenZoom(zoomIn(zoom))}
            aria-label="Zoom in"
            data-testid="button-zoom-in"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={() => setChosenZoom(null)}
            aria-pressed={chosenZoom === null}
            data-testid="button-fit"
          >
            Fit
          </Button>
        </div>
      </div>
    </div>
  );
}
