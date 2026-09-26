import type { Widget } from "@/types";

/**
 * The draft layout the scene editor posts into its preview frame, so the
 * engine's overlay moves widgets as they are dragged instead of only after a
 * save. The overlay applies it on screen and persists nothing.
 *
 * The shape must match `parsePreviewLayout` in the engine
 * (woofx3 sceneManager/public/scene-manager/preview-layout.ts).
 */
export const PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";

export interface PreviewLayoutMessage {
  type: typeof PREVIEW_LAYOUT_MESSAGE;
  widgets: { id: string; x: number; y: number; width: number; height: number }[];
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
  };
}
