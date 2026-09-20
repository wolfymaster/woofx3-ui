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
}

/**
 * The frame both overlay editors share: a left rail of widgets and layers, the
 * canvas in the middle, and a fixed right rail for the selection's settings.
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
}: OverlayEditorShellProps) {
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)_320px]">
        <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto border-r p-4">
          {palette}
          {layers}
        </aside>
        <StageArea canvas={canvas}>{stage}</StageArea>
        <aside className="flex min-h-0 flex-col overflow-y-auto border-l">{inspector ?? inspectorFallback}</aside>
      </div>
    </div>
  );
}
