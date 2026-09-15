import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";
import type { Widget } from "@/types";

interface WidgetFallbackBackgroundProps {
  widget: Widget;
  /** Shown instead of the widget's name. */
  label?: string;
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
export function WidgetFallbackBackground({ widget, label, children }: WidgetFallbackBackgroundProps) {
  const box = {
    left: widget.position.x,
    top: widget.position.y,
    width: widget.size.width,
    height: widget.size.height,
    opacity: widget.opacity / 100,
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
      <span className="text-[10px] opacity-70 px-2 truncate max-w-full">{label ?? widget.name}</span>
    </div>
  );
}
