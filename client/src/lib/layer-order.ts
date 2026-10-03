interface Layer {
  id: string;
  zIndex: number;
}

/** Topmost first, as a layers panel lists them. Ties keep their array order, the later one on top. */
export function layersTopFirst<T extends Layer>(layers: readonly T[]): T[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => b.layer.zIndex - a.layer.zIndex || b.index - a.index)
    .map(({ layer }) => layer);
}

/**
 * Moves one layer to `toIndex` in the topmost-first order and restacks every
 * layer from it: zIndex runs 1 (bottom) to n (top), and the array comes back
 * bottom first. Both matter, because the editors stack by zIndex while the
 * engine's scene manager ignores zIndex and stacks by array order. Returns
 * `layers` itself when nothing moves.
 */
export function moveLayer<T extends Layer>(layers: readonly T[], layerId: string, toIndex: number): T[] {
  const topFirst = layersTopFirst(layers);
  const fromIndex = topFirst.findIndex((layer) => layer.id === layerId);
  const index = Math.max(0, Math.min(toIndex, topFirst.length - 1));
  if (fromIndex === -1 || fromIndex === index) {
    return layers as T[];
  }
  const [moving] = topFirst.splice(fromIndex, 1);
  topFirst.splice(index, 0, moving);
  return topFirst.reverse().map((layer, position) => ({ ...layer, zIndex: position + 1 }));
}

/** The zIndex that puts a new layer on top of `layers`. */
export function nextLayerZIndex(layers: readonly Layer[]): number {
  return layers.reduce((top, layer) => Math.max(top, layer.zIndex), 0) + 1;
}
