import type { Widget } from "@/types";

/**
 * The draft the scene editor posts into its preview frame, so the engine's
 * overlay shows the editor's scene rather than the saved one. `widgets` moves
 * widgets as they are dragged; `placements` carries the widgets themselves,
 * so one added or reconfigured in the editor shows before a save. The overlay
 * applies it on screen and persists nothing.
 *
 * The shape must match `parsePreviewLayout` and `parsePreviewPlacements` in
 * the engine (woofx3 sceneManager/public/scene-manager/preview-layout.ts).
 * Placements are sent as the scene stores them, since the engine parses them
 * exactly as it parses a saved scene.
 */
export const PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";

export interface PreviewLayoutMessage {
  type: typeof PREVIEW_LAYOUT_MESSAGE;
  widgets: { id: string; x: number; y: number; width: number; height: number }[];
  placements: Pick<Widget, "id" | "widgetCanonicalId" | "position" | "size" | "settings">[];
}

export function buildPreviewLayoutMessage(widgets: readonly Widget[]): PreviewLayoutMessage {
  return {
    type: PREVIEW_LAYOUT_MESSAGE,
    widgets: widgets.map((widget) => ({
      id: widget.id,
      x: widget.position.x,
      y: widget.position.y,
      width: widget.size.width,
      height: widget.size.height,
    })),
    placements: widgets.map(({ id, widgetCanonicalId, position, size, settings }) => ({
      id,
      widgetCanonicalId,
      position,
      size,
      settings,
    })),
  };
}
