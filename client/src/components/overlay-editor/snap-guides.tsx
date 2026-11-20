import type { Guide } from "@woofx3/scene/editor";

interface SnapGuidesProps {
  guides: readonly Guide[];
  /** The canvas's scale on screen: guides are in canvas pixels and stay one screen pixel wide. */
  zoom: number;
  /** Stacks the guides above nodes that carry their own z-index. */
  zIndex?: number;
}

/** The lines a dragged node snapped to, drawn inside the scaled canvas. */
export function SnapGuides({ guides, zoom, zIndex }: SnapGuidesProps) {
  return guides.map((guide) => (
    <div
      key={`${guide.axis}-${guide.position}-${guide.source}`}
      className="pointer-events-none absolute bg-pink-400"
      style={
        guide.axis === "vertical"
          ? { left: guide.position, top: 0, bottom: 0, width: 1 / zoom, zIndex }
          : { top: guide.position, left: 0, right: 0, height: 1 / zoom, zIndex }
      }
      data-testid="snap-guide"
    />
  ));
}
