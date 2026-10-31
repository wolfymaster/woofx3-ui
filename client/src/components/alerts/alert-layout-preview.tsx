import { canvasSizeOf } from "@woofx3/scene/editor";
import { type PlacementDocument, stackOrder } from "@woofx3/scene/model";
import { Volume2 } from "lucide-react";
import { useMemo } from "react";
import { alertWidgetPreview } from "@/components/scenes/alert-widget-previews";
import { readAlertComposition } from "@/lib/alert-layout";
import { canvasBackgroundOf } from "@/lib/scene-composition";
import { cn } from "@/lib/utils";

/** The bundled Audio widget, which has nothing to draw and so shows as a small marker. */
export const AUDIO_WIDGET_ID = "woofx3:widget:audio";

interface AlertLayoutPreviewProps {
  /** A step's stored `layout`, in either shape it is stored in (see lib/alert-layout.ts). */
  layout: unknown;
  className?: string;
}

/**
 * A still of an alert: its widgets at their places on the canvas, scaled to whatever
 * box holds it. Drawn in an SVG whose viewBox is the canvas, so every widget keeps its
 * real pixel sizes — a 48 px caption stays a 48 px caption — and the browser does the
 * scaling, with no measuring.
 */
export function AlertLayoutPreview({ layout, className }: AlertLayoutPreviewProps) {
  const doc = useMemo(() => readAlertComposition(layout, (widgetCanonicalId) => widgetCanonicalId), [layout]);
  const canvas = canvasSizeOf(doc);
  const visible = stackOrder(doc)
    .map((id) => ({ id, placement: doc.widgets[id] as PlacementDocument }))
    .filter(({ placement }) => placement.visible);
  return (
    <svg
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      className={cn("block aspect-video w-full rounded-md ring-1 ring-border", className)}
      style={{ background: canvasBackgroundOf(doc.layout) }}
      role="img"
      aria-label={visible.length === 0 ? "Empty alert" : `Alert with ${visible.length} widgets`}
    >
      {visible.map(({ id, placement }) => (
        <foreignObject key={id} x={placement.x} y={placement.y} width={placement.width} height={placement.height}>
          {placement.widget === AUDIO_WIDGET_ID ? (
            <div className="flex h-full w-full items-center justify-center text-white/70">
              <Volume2 style={{ width: placement.height * 0.6, height: placement.height * 0.6 }} />
            </div>
          ) : (
            (alertWidgetPreview(placement.widget, placement.settings) ?? (
              <div
                className="flex h-full w-full items-center justify-center border-4 border-dashed border-white/30 text-white/60"
                style={{ fontSize: Math.max(24, placement.height / 6) }}
              >
                {placement.name}
              </div>
            ))
          )}
        </foreignObject>
      ))}
    </svg>
  );
}
