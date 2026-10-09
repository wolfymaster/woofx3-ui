import { layersTopFirst } from "@/lib/layer-order";
import type { Widget } from "@/types";

export type CoverageLayer = Pick<Widget, "id" | "position" | "size" | "rotation" | "opacity" | "zIndex" | "visible">;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CoverageOptions<T> {
  /**
   * Whether `above` hides `below` where they overlap, beyond what geometry says: an
   * alert layer that ends before the one beneath it does not hide it for good.
   */
  canCover?: (above: T, below: T) => boolean;
}

/**
 * The layers each fully covered layer sits under: for every shown layer whose box
 * lies entirely inside the union of the shown layers above it, the ones among them
 * that overlap it, topmost first. Layers not covered are absent from the map.
 *
 * Only coverage that can be proven from boxes is claimed. A rotated layer neither
 * covers nor is reported, since the canvas has no rotated geometry to test against;
 * a layer with any transparency of its own covers nothing. Transparent pixels inside
 * an opaque layer (a PNG's alpha, the gaps around text) are invisible here, so a
 * covered layer may still show through: callers should say "may not be visible".
 */
export function coveringLayers<T extends CoverageLayer>(
  layers: readonly T[],
  options: CoverageOptions<T> = {}
): Map<string, T[]> {
  const topFirst = layersTopFirst(layers).filter((layer) => layer.visible !== false && !isRotated(layer));
  const covered = new Map<string, T[]>();

  topFirst.forEach((below, belowIndex) => {
    const box = rectOf(below);
    if (isEmpty(box)) {
      return;
    }
    let uncovered: Rect[] = [box];
    const coverers: T[] = [];
    for (const above of topFirst.slice(0, belowIndex)) {
      if (above.opacity < 1 || (options.canCover && !options.canCover(above, below))) {
        continue;
      }
      const cover = rectOf(above);
      if (!uncovered.some((piece) => intersects(piece, cover))) {
        continue;
      }
      coverers.push(above);
      uncovered = uncovered.flatMap((piece) => subtract(piece, cover));
      if (uncovered.length === 0) {
        covered.set(below.id, coverers);
        return;
      }
    }
  });

  return covered;
}

function isRotated(layer: CoverageLayer): boolean {
  return layer.rotation % 360 !== 0;
}

function rectOf(layer: CoverageLayer): Rect {
  return {
    left: layer.position.x,
    top: layer.position.y,
    right: layer.position.x + layer.size.width,
    bottom: layer.position.y + layer.size.height,
  };
}

function isEmpty(rect: Rect): boolean {
  return rect.right <= rect.left || rect.bottom <= rect.top;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** `rect` minus `cut`, as up to four non-overlapping rects: full-width bands above and below, then sides. */
function subtract(rect: Rect, cut: Rect): Rect[] {
  if (!intersects(rect, cut)) {
    return [rect];
  }
  const top = Math.max(rect.top, cut.top);
  const bottom = Math.min(rect.bottom, cut.bottom);
  const pieces: Rect[] = [
    { left: rect.left, top: rect.top, right: rect.right, bottom: top },
    { left: rect.left, top: bottom, right: rect.right, bottom: rect.bottom },
    { left: rect.left, top, right: Math.max(rect.left, cut.left), bottom },
    { left: Math.min(rect.right, cut.right), top, right: rect.right, bottom },
  ];
  return pieces.filter((piece) => !isEmpty(piece));
}

/**
 * What a covered layer's row says. It hedges, because coverage is by box and a
 * covering layer's transparent pixels still let the one beneath show.
 */
export function coveredNotice(covererNames: readonly string[]): string {
  if (covererNames.length === 0) {
    throw new Error("coveredNotice needs at least one covering layer");
  }
  const named =
    covererNames.length <= 3 ? covererNames : [...covererNames.slice(0, 2), `${covererNames.length - 2} more`];
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `Fully covered by ${list}, so it may not be visible`;
}
