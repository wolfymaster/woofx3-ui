import { describe, expect, test } from "bun:test";
import { cleanupBatchSize } from "./cleanupBatch";

describe("cleanupBatchSize", () => {
  test.each([
    [undefined, 200],
    [1, 1],
    [50, 50],
  ])("a requested size of %p gives %p", (requested, expected) => {
    expect(cleanupBatchSize(requested, 200)).toBe(expected);
  });

  test.each([0, -1, 1.5, Number.NaN])("refuses a size of %p, which would never end a chain", (requested) => {
    expect(() => cleanupBatchSize(requested, 200)).toThrow("positive integer");
  });
});
