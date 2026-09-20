import { Volume2 } from "lucide-react";
import { alertWidgetPreview } from "@/components/scenes/alert-widget-previews";
import type { AlertLayout } from "@/lib/alert-layout";
import { cn } from "@/lib/utils";

/** The bundled Audio widget, which has nothing to draw and so shows as a small marker. */
export const AUDIO_WIDGET_ID = "woofx3:widget:audio";

interface AlertLayoutPreviewProps {
  layout: AlertLayout;
  className?: string;
}

/**
 * A still of an alert: its widgets at their places on the canvas, scaled to whatever
 * box holds it. Drawn in an SVG whose viewBox is the canvas, so every widget keeps its
 * real pixel sizes — a 48 px caption stays a 48 px caption — and the browser does the
 * scaling, with no measuring.
 */
export function AlertLayoutPreview({ layout, className }: AlertLayoutPreviewProps) {
  const visible = layout.widgets.filter((widget) => widget.visible);
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={cn("block aspect-video w-full rounded-md bg-black", className)}
      role="img"
      aria-label={visible.length === 0 ? "Empty alert" : `Alert with ${visible.length} widgets`}
    >
      {visible.map((widget) => (
        <foreignObject
          key={widget.id}
          x={widget.position.x}
          y={widget.position.y}
          width={widget.size.width}
          height={widget.size.height}
        >
          {widget.widgetCanonicalId === AUDIO_WIDGET_ID ? (
            <div className="flex h-full w-full items-center justify-center text-white/70">
              <Volume2 style={{ width: widget.size.height * 0.6, height: widget.size.height * 0.6 }} />
            </div>
          ) : (
            (alertWidgetPreview(widget) ?? (
              <div
                className="flex h-full w-full items-center justify-center border-4 border-dashed border-white/30 text-white/60"
                style={{ fontSize: Math.max(24, widget.size.height / 6) }}
              >
                {widget.name}
              </div>
            ))
          )}
        </foreignObject>
      ))}
    </svg>
  );
}
