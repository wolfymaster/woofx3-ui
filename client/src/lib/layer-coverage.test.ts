import { describe, expect, test } from "bun:test";
import { type CoverageLayer, coveredNotice, coveringLayers } from "./layer-coverage";

function layer(id: string, zIndex: number, x: number, y: number, width: number, height: number): CoverageLayer {
  return {
    id,
    zIndex,
    position: { x, y },
    size: { width, height },
    rotation: 0,
    opacity: 1,
    visible: true,
  };
}

function coveredIds(layers: CoverageLayer[]): Record<string, string[]> {
  return Object.fromEntries(
    [...coveringLayers(layers)].map(([id, coverers]) => [id, coverers.map((coverer) => coverer.id)])
  );
}

describe("coveringLayers", () => {
  test("a layer inside a larger one above it is covered by it", () => {
    expect(coveredIds([layer("small", 1, 10, 10, 50, 50), layer("big", 2, 0, 0, 100, 100)])).toEqual({
      small: ["big"],
    });
  });

  test("a larger layer above a smaller one is not covered", () => {
    expect(coveredIds([layer("big", 1, 0, 0, 100, 100), layer("small", 2, 10, 10, 50, 50)])).toEqual({});
  });

  test("a layer with the same box as the one above it is covered", () => {
    expect(coveredIds([layer("a", 1, 0, 0, 100, 100), layer("b", 2, 0, 0, 100, 100)])).toEqual({ a: ["b"] });
  });

  test("a layer only partly overlapped is not covered", () => {
    expect(coveredIds([layer("below", 1, 0, 0, 100, 100), layer("above", 2, 50, 0, 100, 100)])).toEqual({});
  });

  test("two layers above that together cover it both count", () => {
    const below = layer("below", 1, 0, 0, 100, 100);
    const left = layer("left", 2, 0, 0, 60, 100);
    const right = layer("right", 3, 50, 0, 50, 100);
    expect(coveredIds([below, left, right])).toEqual({ below: ["right", "left"] });
  });

  test("a gap between the layers above leaves it uncovered", () => {
    const below = layer("below", 1, 0, 0, 100, 100);
    const left = layer("left", 2, 0, 0, 49, 100);
    const right = layer("right", 3, 50, 0, 50, 100);
    expect(coveredIds([below, left, right])).toEqual({});
  });

  test("names only the layers above that overlap it", () => {
    const below = layer("below", 1, 0, 0, 100, 100);
    const elsewhere = layer("elsewhere", 2, 500, 500, 10, 10);
    const cover = layer("cover", 3, 0, 0, 100, 100);
    expect(coveredIds([below, elsewhere, cover])).toEqual({ below: ["cover"] });
  });

  test("stacks by zIndex, not array order", () => {
    expect(coveredIds([layer("big", 2, 0, 0, 100, 100), layer("small", 1, 10, 10, 50, 50)])).toEqual({
      small: ["big"],
    });
  });

  test("of two equal zIndexes the later one is on top", () => {
    expect(coveredIds([layer("first", 1, 0, 0, 100, 100), layer("second", 1, 0, 0, 100, 100)])).toEqual({
      first: ["second"],
    });
  });

  test("a hidden layer covers nothing and is not reported", () => {
    const below = layer("below", 1, 0, 0, 100, 100);
    const hiddenCover = { ...layer("hiddenCover", 2, 0, 0, 100, 100), visible: false };
    expect(coveredIds([below, hiddenCover])).toEqual({});

    const hiddenBelow = { ...layer("hiddenBelow", 1, 0, 0, 100, 100), visible: false };
    expect(coveredIds([hiddenBelow, layer("cover", 2, 0, 0, 100, 100)])).toEqual({});
  });

  test("a partly transparent layer covers nothing", () => {
    const cover = { ...layer("cover", 2, 0, 0, 100, 100), opacity: 0.5 };
    expect(coveredIds([layer("below", 1, 10, 10, 10, 10), cover])).toEqual({});
  });

  test("a rotated layer neither covers nor is reported", () => {
    const rotatedCover = { ...layer("rotatedCover", 2, 0, 0, 100, 100), rotation: 45 };
    expect(coveredIds([layer("below", 1, 10, 10, 10, 10), rotatedCover])).toEqual({});

    const rotatedBelow = { ...layer("rotatedBelow", 1, 10, 10, 10, 10), rotation: 90 };
    expect(coveredIds([rotatedBelow, layer("cover", 2, 0, 0, 100, 100)])).toEqual({});
  });

  test("a full turn is not a rotation", () => {
    const cover = { ...layer("cover", 2, 0, 0, 100, 100), rotation: 360 };
    expect(coveredIds([layer("below", 1, 10, 10, 10, 10), cover])).toEqual({ below: ["cover"] });
  });

  test("a layer with no area is not reported", () => {
    expect(coveredIds([layer("empty", 1, 10, 10, 0, 10), layer("cover", 2, 0, 0, 100, 100)])).toEqual({});
  });

  test("canCover rules out a layer that would otherwise cover", () => {
    const below = layer("below", 1, 10, 10, 10, 10);
    const cover = layer("cover", 2, 0, 0, 100, 100);
    const result = coveringLayers([below, cover], { canCover: (above) => above.id !== "cover" });
    expect(result.size).toBe(0);
  });

  test("covers a layer by many small pieces", () => {
    const below = layer("below", 0, 0, 0, 100, 100);
    const tiles = [0, 25, 50, 75].flatMap((x, column) =>
      [0, 25, 50, 75].map((y, row) => layer(`tile-${column}-${row}`, 1 + column * 4 + row, x, y, 25, 25))
    );
    expect(coveringLayers([below, ...tiles]).get("below")).toHaveLength(16);
  });
});

describe("coveredNotice", () => {
  test("names one covering layer", () => {
    expect(coveredNotice(["Banner"])).toBe("Fully covered by Banner, so it may not be visible");
  });

  test("names up to three covering layers", () => {
    expect(coveredNotice(["A", "B"])).toBe("Fully covered by A and B, so it may not be visible");
    expect(coveredNotice(["A", "B", "C"])).toBe("Fully covered by A, B and C, so it may not be visible");
  });

  test("counts the rest past three", () => {
    expect(coveredNotice(["A", "B", "C", "D"])).toBe("Fully covered by A, B and 2 more, so it may not be visible");
  });

  test("refuses an empty list", () => {
    expect(() => coveredNotice([])).toThrow();
  });
});
