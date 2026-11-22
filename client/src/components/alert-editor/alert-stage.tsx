import type { CanvasSize, CompositionEditor, NodeView, WidgetKind } from "@woofx3/scene/editor";
import { Film, Sparkles, Square, Volume2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { CompositionPreviewFrame } from "@/components/alert-editor/composition-preview-frame";
import { CANVAS_STAGE_CLASS } from "@/components/common/stage-area";
import { SnapGuides } from "@/components/overlay-editor/snap-guides";
import { alertWidgetPreview, TextWidgetPreview } from "@/components/scenes/alert-widget-previews";
import type { CompositionPreviewController } from "@/hooks/use-composition-preview";
import type { OverlayStageView } from "@/hooks/use-overlay-stage";
import { cn } from "@/lib/utils";

interface AlertStageProps {
  editor: CompositionEditor;
  canvas: CanvasSize;
  /** What the canvas draws behind the layers (canvasBackgroundOf). */
  background: string;
  /** The editor's nodes, bottom of the stack first. */
  nodes: readonly NodeView[];
  /** The stage glue shared with the scene canvas: gestures, snap guides, deselect. */
  stage: OverlayStageView;
  zoom: number;
  /** The label a layer goes by, shared with the layers list. */
  layerLabel: (node: NodeView) => string;
  /** A Text layer's text as the page shows it, with variable references shortened. */
  displayText: (text: string) => string;
  /**
   * The engine's live preview, framed behind the layers. While it plays the
   * alert, layers draw only their outlines and handles over it, except those
   * it cannot draw; until then, and without one, the stand-ins draw.
   */
  preview?: CompositionPreviewController | null;
}

/** On-screen size of the selected layer's corner handle, and of the press area around it. */
const HANDLE_DOT = 12;
const HANDLE_HIT = 32;

/**
 * The alert's canvas at `zoom`, drawn from the composition editor's state:
 * layers are selected, dragged, and resized by the selected layer's
 * bottom-right corner, and the editor does the geometry (snapping, the
 * canvas clamp, aspect, the minimum size) and commits each gesture as one
 * change when the pointer is released.
 *
 * The canvas is laid out at full size and scaled as one piece, so each layer
 * renders at its real pixel sizes. A gesture captures the pointer, so a fast
 * drag that leaves the layer keeps moving it, and pointer moves reach the
 * editor at most once per frame.
 *
 * With the engine's preview, the real widgets play in a frame under the
 * layers, at the same place and zoom, and each layer becomes a transparent
 * press area with its outline and handle; the stand-ins are the fallback.
 *
 * Key presses on the stage go straight to the editor as well as through the
 * page's window listener, because inside a dialog that listener leaves keys
 * to the dialog; a key the editor used here is marked handled, so the
 * listener does not run it twice.
 */
export function AlertStage({
  editor,
  canvas,
  background,
  nodes,
  stage,
  zoom,
  layerLabel,
  displayText,
  preview = null,
}: AlertStageProps) {
  const layers = nodes.filter((node) => node.placement.visible);

  const sendKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return;
    }
    if (editor.handleKey(event)) {
      event.preventDefault();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the canvas background deselects, and its focused layers send keys to the editor
    <div
      className={CANVAS_STAGE_CLASS}
      style={{ width: canvas.width * zoom, height: canvas.height * zoom, background }}
      onPointerDown={stage.deselectOnBackground}
      onKeyDown={sendKey}
    >
      {preview?.frame && (
        <CompositionPreviewFrame
          frame={preview.frame}
          width={canvas.width * zoom}
          height={canvas.height * zoom}
          visible={preview.live}
        />
      )}
      <div
        ref={stage.canvasRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: canvas.width, height: canvas.height, transform: `scale(${zoom})` }}
        onPointerDown={stage.deselectOnBackground}
      >
        {layers.map((node) => {
          const { box } = node;
          return (
            <button
              key={node.id}
              type="button"
              aria-label={layerLabel(node)}
              aria-pressed={node.selected}
              className="absolute cursor-move touch-none p-0 text-left outline-none"
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
                transform: box.rotation === 0 ? undefined : `rotate(${box.rotation}deg)`,
              }}
              onPointerDown={(event) => stage.gestures.begin(event, node, "move")}
              // Pointer events from the corner handle bubble to its layer, so one handler serves both gestures.
              onPointerMove={stage.gestures.continue}
              onPointerUp={stage.gestures.end}
              onPointerCancel={stage.gestures.cancel}
              onFocus={() => {
                if (!node.selected) {
                  editor.dispatch("selection.select", { id: node.id });
                }
              }}
              data-testid={`stage-layer-${node.id}`}
            >
              <div className="pointer-events-none h-full w-full">
                {(!preview?.live || preview.undrawn.has(node.id)) && (
                  <LayerContent node={node} displayText={displayText} />
                )}
              </div>
              <div
                className={cn(
                  "pointer-events-none absolute inset-0",
                  node.selected ? "outline outline-primary" : "outline-dashed outline-white/0 hover:outline-white/40"
                )}
                style={{ outlineWidth: 2 / zoom }}
              />
              {node.selected && !node.placement.locked && (
                <span
                  className="absolute flex cursor-se-resize items-center justify-center"
                  style={{
                    right: -HANDLE_HIT / 2 / zoom,
                    bottom: -HANDLE_HIT / 2 / zoom,
                    width: HANDLE_HIT / zoom,
                    height: HANDLE_HIT / zoom,
                  }}
                  onPointerDown={(event) => stage.gestures.begin(event, node, "resize")}
                  data-testid={`stage-layer-${node.id}-resize`}
                >
                  <span
                    className="rounded-full bg-primary"
                    style={{ width: HANDLE_DOT / zoom, height: HANDLE_DOT / zoom }}
                  />
                </span>
              )}
            </button>
          );
        })}
        <SnapGuides guides={stage.guides} zoom={zoom} />
      </div>
    </div>
  );
}

const KIND_ICON: Record<Exclude<WidgetKind, "text">, typeof Square> = {
  image: Square,
  video: Film,
  audio: Volume2,
  lottie: Sparkles,
  other: Square,
};

/** What a layer looks like on the stage: the Text and Image stand-ins, or a labelled box. */
function LayerContent({ node, displayText }: { node: NodeView; displayText: (text: string) => string }) {
  const { kind, placement } = node;
  if (kind === "text") {
    const text = typeof placement.settings.text === "string" ? placement.settings.text : "";
    return <TextWidgetPreview settings={{ ...placement.settings, text: displayText(text) }} />;
  }
  if (kind === "audio") {
    return (
      <div className="flex h-full w-full items-center justify-center gap-3 rounded-full bg-white/10 text-2xl text-white/80">
        <Volume2 className="h-8 w-8" />
        {placement.name}
      </div>
    );
  }
  const preview = alertWidgetPreview(placement.widget, placement.settings);
  if (preview) {
    return <>{preview}</>;
  }
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 border-4 border-dashed border-white/25 bg-white/5 text-2xl text-white/60">
      <Icon className="h-12 w-12" />
      {placement.name}
    </div>
  );
}
