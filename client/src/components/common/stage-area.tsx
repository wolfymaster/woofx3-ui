import { type CanvasSize, fitZoom, zoomIn, zoomOut } from "@woofx3/scene/editor";
import { Minus, Plus } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Room around the canvas when it is fitted to the stage area, and below it for the bottom bar. */
const FIT_PADDING = 32;
const BOTTOM_BAR_ROOM = 48;

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
  /**
   * The room the canvas has: the area less the bottom bar. Fit follows it. Stable
   * for as long as the same receiver is measured: the area observes again when it changes.
   */
  onMeasure: (size: CanvasSize) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
}

interface StageAreaProps {
  canvas: CanvasSize;
  /** Omitted, the area keeps the zoom itself. */
  zoomControl?: StageZoom;
  /** Shown in the bottom bar before the zoom controls: the canvas readout, an alert's timeline. */
  toolbar?: ReactNode;
  /** A press on the area around the canvas, which deselects. Presses on the canvas are the canvas's own. */
  onBackgroundPress?: () => void;
  /** How the area claims its space: a grid cell needs nothing, a flex child needs `flex-1`. */
  className?: string;
  /** The canvas itself, drawn at the zoom the area settled on. */
  children: (zoom: number) => ReactNode;
}

/**
 * The scrollable area a canvas is edited in: dot grid behind it, the canvas centered,
 * and a light bar over its bottom edge with the zoom, which follows the area's size
 * until the user picks a level, after whatever the editor puts in `toolbar`.
 *
 * Shared by the alert editor and the scene editor so both read as one surface.
 * It owns only the framing and the zoom; the canvas it is handed draws its own
 * background and decides what a press on it means, which is why an alert stage
 * and a scene canvas can sit in the same area without this knowing about either.
 */
export function StageArea({ canvas, zoomControl, toolbar, onBackgroundPress, className, children }: StageAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
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
  const { zoom, onMeasure } = control;

  // Observing reports the current size at once, so a new `onMeasure` (an editor
  // that replaced the last one and has not been measured) learns the room it has.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      onMeasure({ width, height: height - BOTTOM_BAR_ROOM });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [onMeasure]);

  // Only a press on the area itself or the box centering the canvas is "outside the
  // canvas"; anything inside the canvas handles its own presses.
  const pressBackground = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === areaRef.current || event.target === centerRef.current) {
      onBackgroundPress?.();
    }
  };

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a press around the canvas deselects; the keyboard deselects with Escape */}
      <div
        ref={areaRef}
        className="absolute inset-0 overflow-auto"
        style={{
          backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
        onPointerDown={pressBackground}
        data-testid="stage-area"
      >
        <div
          ref={centerRef}
          className="flex min-h-full min-w-full items-center justify-center p-8 pb-16"
          style={{ width: "max-content" }}
        >
          {children(zoom)}
        </div>
      </div>
      <div
        className={cn(
          "absolute inset-x-3 bottom-3 flex h-9 items-center gap-2 rounded-lg border border-border/60 px-2",
          "bg-background/75 text-xs text-muted-foreground shadow-sm backdrop-blur-sm"
        )}
        data-testid="stage-bottom-bar"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 font-mono">{toolbar}</div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={control.zoomOut}
            aria-label="Zoom out"
            data-testid="button-zoom-out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={control.zoomIn}
            aria-label="Zoom in"
            data-testid="button-zoom-in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className={cn("h-7 px-2 text-xs", control.fit && "text-foreground")}
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
