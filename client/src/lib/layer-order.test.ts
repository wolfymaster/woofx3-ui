import { describe, expect, test } from "bun:test";
import { layersTopFirst, moveLayer, nextLayerZIndex } from "./layer-order";

const a = { id: "a", zIndex: 1 };
const b = { id: "b", zIndex: 2 };
const c = { id: "c", zIndex: 3 };

describe("layersTopFirst", () => {
  test("orders by zIndex, highest first", () => {
    expect(layersTopFirst([b, c, a]).map((layer) => layer.id)).toEqual(["c", "b", "a"]);
  });

  test("puts the later of two equal zIndexes on top", () => {
    const tied = [
      { id: "x", zIndex: 1 },
      { id: "y", zIndex: 1 },
    ];
    expect(layersTopFirst(tied).map((layer) => layer.id)).toEqual(["y", "x"]);
  });
});

describe("moveLayer", () => {
  test("moving the bottom layer to the top restacks every layer", () => {
    expect(moveLayer([a, b, c], "a", 0)).toEqual([
      { id: "b", zIndex: 1 },
      { id: "c", zIndex: 2 },
      { id: "a", zIndex: 3 },
    ]);
  });

  test("moving the top layer to the bottom", () => {
    expect(moveLayer([a, b, c], "c", 2).map((layer) => layer.id)).toEqual(["c", "a", "b"]);
  });

  test("returns the array bottom first even when it arrived in another order", () => {
    const next = moveLayer([c, a, b], "b", 0);
    expect(next.map((layer) => [layer.id, layer.zIndex])).toEqual([
      ["a", 1],
      ["c", 2],
      ["b", 3],
    ]);
  });

  test("closes gaps left by deleted layers", () => {
    const gappy = [
      { id: "a", zIndex: 2 },
      { id: "b", zIndex: 7 },
    ];
    expect(moveLayer(gappy, "a", 0).map((layer) => layer.zIndex)).toEqual([1, 2]);
  });

  test("returns the same array when nothing moves", () => {
    const layers = [a, b, c];
    expect(moveLayer(layers, "c", 0)).toBe(layers);
    expect(moveLayer(layers, "missing", 1)).toBe(layers);
  });
});

describe("nextLayerZIndex", () => {
  test("goes above the highest layer, not the count", () => {
    expect(nextLayerZIndex([{ id: "a", zIndex: 5 }])).toBe(6);
    expect(nextLayerZIndex([])).toBe(1);
  });
});
