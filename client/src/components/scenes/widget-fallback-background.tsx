import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";

/** The placeholder label's size in canvas pixels: a share of the widget's box, never below the floor. */
const PLACEHOLDER_LABEL = { minPx: 16, heightShare: 0.12, widthShare: 0.08 } as const;

interface WidgetFallbackBackgroundProps {
  /** The widget's box on the canvas, rotated about its centre. */
  box: { x: number; y: number; width: number; height: number; rotation: number };
  opacity: number;
  /** What the generic placeholder calls the widget. */
  label: string;
  /** A widget-specific stand-in, drawn instead of the generic placeholder. */
  children?: ReactNode;
}

/**
 * Rendered behind LiveScenePreview's iframe, matching each widget's bounding box.
 * The engine overlay leaves transparent pixels wherever a widget isn't actually
 * rendering — not yet saved, a failed asset, a misconfigured widget — so this
 * shows through in exactly those gaps instead of the widget just looking like
 * empty canvas. Widgets that render fine paint over it, since the iframe sits
 * above this layer.
 */
export function WidgetFallbackBackground({ box: placed, opacity, label, children }: WidgetFallbackBackgroundProps) {
  const box = {
    left: placed.x,
    top: placed.y,
    width: placed.width,
    height: placed.height,
    opacity,
    transform: placed.rotation === 0 ? undefined : `rotate(${placed.rotation}deg)`,
  };
  if (children) {
    return (
      <div className="absolute overflow-hidden" style={box}>
        {children}
      </div>
    );
  }
  // The canvas is drawn at its real size and scaled down to fit, so a fixed type size
  // shrinks with it. Sizing the label from the widget's own box keeps it in proportion
  // to the widget at every zoom.
  const labelSize = Math.max(
    PLACEHOLDER_LABEL.minPx,
    Math.min(placed.height * PLACEHOLDER_LABEL.heightShare, placed.width * PLACEHOLDER_LABEL.widthShare)
  );
  return (
    <div
      className="absolute flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground overflow-hidden"
      style={{
        ...box,
        backgroundImage:
          "repeating-linear-gradient(45deg, hsl(var(--border)) 0, hsl(var(--border)) 1px, transparent 1px, transparent 12px)",
      }}
    >
      <ImageOff className="opacity-60" style={{ width: labelSize * 1.5, height: labelSize * 1.5 }} />
      <span className="opacity-70 px-2 truncate max-w-full" style={{ fontSize: labelSize }}>
        {label}
      </span>
    </div>
  );
}
