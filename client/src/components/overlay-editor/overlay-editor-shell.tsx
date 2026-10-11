import type { ReactNode } from "react";
import { StageArea } from "@/components/common/stage-area";
import type { CanvasSize } from "@/lib/alert-editor";
import { cn } from "@/lib/utils";

interface OverlayEditorShellProps {
  canvas: CanvasSize;
  /** The editor's own title bar. Omitted where the editor is embedded in a field. */
  header?: ReactNode;
  /** Tiles that add a widget; see WidgetPalette. */
  palette: ReactNode;
  /** What is already on the canvas; see LayersList. */
  layers: ReactNode;
  /** The canvas, drawn at the zoom the stage area settled on. */
  stage: (zoom: number) => ReactNode;
  /** The selected widget's settings, or null when nothing is selected. */
  inspector: ReactNode | null;
  /** What the right rail shows with nothing selected, so the rail is never empty. */
  inspectorFallback: ReactNode;
  /**
   * How the shell claims its height: `h-full` as a page's root, `flex-1` as a
   * flex child that sits below a sibling header (the alert-layout dialog).
   */
  className?: string;
  /**
   * Shown but not editable: a scene the editor's session has not loaded yet,
   * or one that no longer exists. The header stays live.
   */
  readOnly?: boolean;
}

/**
 * The frame both overlay editors share: a left rail of widgets to add, the
 * canvas in the middle, and a fixed right rail with the layers above the
 * selection's settings. Layers sit beside the settings because picking a layer
 * is how a widget gets selected, and the left rail is left whole for the
 * widget palette, which grows with every module installed.
 *
 * The layers list takes at most two fifths of the right rail and scrolls past
 * that, so a long stack never pushes the settings out of reach.
 *
 * The right rail is always present, showing `inspectorFallback` when nothing is
 * selected. That is load-bearing, not decoration: the scene editor used to float
 * the settings panel over the canvas precisely because docking it as a flex
 * sibling stole width from the canvas, so selecting a widget resized the canvas
 * and shifted the scene under the cursor mid-click. A fixed grid column that
 * exists whether or not anything is selected has neither problem — the canvas
 * never changes width — so the panel can dock.
 */
export function OverlayEditorShell({
  canvas,
  header,
  palette,
  layers,
  stage,
  inspector,
  inspectorFallback,
  className = "h-full",
  readOnly = false,
}: OverlayEditorShellProps) {
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      {header}
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)_320px] transition-opacity",
          readOnly && "pointer-events-none select-none opacity-60"
        )}
        aria-disabled={readOnly}
        data-testid="overlay-editor-body"
      >
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r p-4">{palette}</aside>
        <StageArea canvas={canvas}>{stage}</StageArea>
        <aside className="flex min-h-0 flex-col border-l">
          <div className="max-h-[40%] shrink-0 overflow-y-auto border-b p-4" data-testid="editor-layers">
            {layers}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{inspector ?? inspectorFallback}</div>
        </aside>
      </div>
    </div>
  );
}
