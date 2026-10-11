import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";

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
  return (
    <div
      className="absolute flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground overflow-hidden"
      style={{
        ...box,
        backgroundImage:
          "repeating-linear-gradient(45deg, hsl(var(--border)) 0, hsl(var(--border)) 1px, transparent 1px, transparent 12px)",
      }}
    >
      <ImageOff className="h-5 w-5 opacity-60" />
      <span className="text-[10px] opacity-70 px-2 truncate max-w-full">{label}</span>
    </div>
  );
}
