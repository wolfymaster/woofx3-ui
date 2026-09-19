import { Film, Sparkles, Square, Volume2 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { alertWidgetPreview, TextWidgetPreview } from "@/components/scenes/alert-widget-previews";
import {
  centerOf,
  clampCenter,
  type LayerKind,
  layerKind,
  type Point,
  SNAP_DISTANCE,
  SNAP_DISTANCE_TOUCH,
  snapToCenter,
} from "@/lib/alert-editor";
import type { AlertLayout } from "@/lib/alert-layout";
import { cn } from "@/lib/utils";
import type { Widget } from "@/types";

interface AlertStageProps {
  layout: AlertLayout;
  selectedId: string | null;
  zoom: number;
  /** The label a layer goes by, shared with the layers list. */
  layerLabel: (widget: Widget) => string;
  /** A Text layer's text as the page shows it, with variable references shortened. */
  displayText: (text: string) => string;
  onSelect: (widgetId: string | null) => void;
  onMove: (widgetId: string, center: Point) => void;
  /** Arrow keys and Delete, from the stage or a focused layer; see AlertEditorPage. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

interface Drag {
  widgetId: string;
  pointerId: number;
  startPointer: Point;
  startCenter: Point;
  /** Screen pixels per canvas pixel, measured when the drag started. */
  scale: number;
}

/**
 * The alert's canvas at `zoom`, where layers are selected and dragged.
 *
 * The canvas is laid out at full size and scaled as one piece, so each layer renders
 * at its real pixel sizes. A drag measures the stage's on-screen width rather than
 * trusting `zoom`, because a parent may scale the stage again; and it captures the
 * pointer, so a fast drag that leaves the layer keeps moving it.
 */
export function AlertStage({
  layout,
  selectedId,
  zoom,
  layerLabel,
  displayText,
  onSelect,
  onMove,
  onKeyDown,
}: AlertStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState({ vertical: false, horizontal: false });
  const layers = [...layout.widgets].filter((widget) => widget.visible).sort((a, b) => a.zIndex - b.zIndex);

  const beginDrag = (widget: Widget) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !stageRef.current) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(widget.id);
    drag.current = {
      widgetId: widget.id,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startCenter: centerOf(widget),
      scale: stageRef.current.getBoundingClientRect().width / layout.width,
    };
  };

  const continueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || current.scale <= 0) {
      return;
    }
    const moved = clampCenter(
      {
        x: current.startCenter.x + (event.clientX - current.startPointer.x) / current.scale,
        y: current.startCenter.y + (event.clientY - current.startPointer.y) / current.scale,
      },
      layout
    );
    const snapped = snapToCenter(moved, layout, event.pointerType === "touch" ? SNAP_DISTANCE_TOUCH : SNAP_DISTANCE);
    setGuides({ vertical: snapped.onVertical, horizontal: snapped.onHorizontal });
    onMove(current.widgetId, snapped.center);
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setGuides({ vertical: false, horizontal: false });
    }
  };

  // Deselect only when the press lands on the canvas itself: a press on a layer stops
  // propagation, and a click event would arrive on a common ancestor after a drag.
  const deselectOnBackground = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onSelect(null);
    }
  };

  return (
    <div
      ref={stageRef}
      className="relative shrink-0 overflow-hidden bg-[#050507] shadow-lg"
      style={{ width: layout.width * zoom, height: layout.height * zoom }}
      onPointerDown={deselectOnBackground}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
        onPointerDown={deselectOnBackground}
      >
        {layers.map((widget) => {
          const isSelected = widget.id === selectedId;
          return (
            <button
              key={widget.id}
              type="button"
              aria-label={layerLabel(widget)}
              aria-pressed={isSelected}
              className="absolute cursor-move touch-none p-0 text-left outline-none"
              style={{
                left: widget.position.x,
                top: widget.position.y,
                width: widget.size.width,
                height: widget.size.height,
              }}
              onPointerDown={beginDrag(widget)}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onFocus={() => onSelect(widget.id)}
              onKeyDown={onKeyDown}
              data-testid={`stage-layer-${widget.id}`}
            >
              <div className="pointer-events-none h-full w-full">
                <LayerContent widget={widget} displayText={displayText} />
              </div>
              <div
                className={cn(
                  "pointer-events-none absolute inset-0",
                  isSelected ? "outline outline-primary" : "outline-dashed outline-white/0 hover:outline-white/40"
                )}
                style={{ outlineWidth: 2 / zoom }}
              />
            </button>
          );
        })}
        {guides.vertical && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 bg-pink-400"
            style={{ left: layout.width / 2, width: 1 / zoom }}
          />
        )}
        {guides.horizontal && (
          <div
            className="pointer-events-none absolute left-0 right-0 bg-pink-400"
            style={{ top: layout.height / 2, height: 1 / zoom }}
          />
        )}
      </div>
    </div>
  );
}

const KIND_ICON: Record<Exclude<LayerKind, "text">, typeof Square> = {
  image: Square,
  video: Film,
  audio: Volume2,
  lottie: Sparkles,
  other: Square,
};

/** What a layer looks like on the stage: the Text and Image stand-ins, or a labelled box. */
function LayerContent({ widget, displayText }: { widget: Widget; displayText: (text: string) => string }) {
  const kind = layerKind(widget);
  if (kind === "text") {
    const text = typeof widget.settings.text === "string" ? widget.settings.text : "";
    return <TextWidgetPreview settings={{ ...widget.settings, text: displayText(text) }} />;
  }
  if (kind === "audio") {
    return (
      <div className="flex h-full w-full items-center justify-center gap-3 rounded-full bg-white/10 text-2xl text-white/80">
        <Volume2 className="h-8 w-8" />
        {widget.name}
      </div>
    );
  }
  const preview = alertWidgetPreview(widget);
  if (preview) {
    return <>{preview}</>;
  }
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 border-4 border-dashed border-white/25 bg-white/5 text-2xl text-white/60">
      <Icon className="h-12 w-12" />
      {widget.name}
    </div>
  );
}
