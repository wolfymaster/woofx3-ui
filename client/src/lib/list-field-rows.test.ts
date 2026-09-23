import { describe, expect, test } from "bun:test";
import { listRows, withRowChanged, withRowRemoved } from "./list-field-rows";

describe("listRows", () => {
  test("reads an array of rows, skipping anything that is not a row", () => {
    expect(listRows([{ value: 1 }, null, 3, [4], { value: 5, name: "Five" }], "value")).toEqual([
      { value: 1 },
      { value: 5, name: "Five" },
    ]);
  });

  test("reads a comma-separated string as rows of its first field, so the first edit keeps them", () => {
    expect(listRows("100, 250 ,, ", "value")).toEqual([{ value: "100" }, { value: "250" }]);
  });

  test("reads nothing as no rows", () => {
    expect(listRows(undefined, "value")).toEqual([]);
    expect(listRows("", "value")).toEqual([]);
    expect(listRows("100", undefined)).toEqual([]);
  });
});

describe("row edits", () => {
  const rows = [{ value: 1 }, { value: 2 }, { value: 3 }];

  test("change one field of one row and leave the rest", () => {
    expect(withRowChanged(rows, 1, "name", "Two")).toEqual([{ value: 1 }, { value: 2, name: "Two" }, { value: 3 }]);
    expect(rows[1]).toEqual({ value: 2 });
  });

  test("remove one row", () => {
    expect(withRowRemoved(rows, 0)).toEqual([{ value: 2 }, { value: 3 }]);
  });
});
