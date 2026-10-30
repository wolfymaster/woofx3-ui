import { describe, expect, test } from "bun:test";
import {
  compareMacroOrder,
  isHexColor,
  type MacroFields,
  macroFieldsProblem,
  macroOrderChanges,
  nextMacroSortOrder,
} from "./macro-pad";

describe("isHexColor", () => {
  const cases: Array<{ value: string | undefined; expected: boolean }> = [
    { value: "#3b82f6", expected: true },
    { value: "#ABCDEF", expected: true },
    { value: "#fff", expected: false },
    { value: "#3b82f6aa", expected: false },
    { value: "3b82f6", expected: false },
    { value: "", expected: false },
    { value: undefined, expected: false },
  ];
  for (const { value, expected } of cases) {
    test(String(value), () => {
      expect(isHexColor(value)).toBe(expected);
    });
  }
});

describe("macroFieldsProblem", () => {
  const base: MacroFields = { label: "Hype", type: "send-message", config: { message: "hype!" } };
  const cases: Array<{ name: string; fields: MacroFields; expected: string | null }> = [
    { name: "a complete macro", fields: base, expected: null },
    { name: "a color and an icon", fields: { ...base, icon: "Zap", color: "#22c55e" }, expected: null },
    { name: "a blank label", fields: { ...base, label: "  " }, expected: "A macro needs a label" },
    {
      name: "a short hex color",
      fields: { ...base, color: "#fff" },
      expected: "A macro's color must be a six-digit hex color such as #3b82f6",
    },
  ];
  for (const { name, fields, expected } of cases) {
    test(name, () => {
      expect(macroFieldsProblem(fields)).toBe(expected);
    });
  }
});

describe("nextMacroSortOrder", () => {
  const cases: Array<{ name: string; sortOrders: number[]; expected: number }> = [
    { name: "an empty pad", sortOrders: [], expected: 0 },
    { name: "after the last", sortOrders: [0, 1, 2], expected: 3 },
    { name: "after the largest, in any order and with gaps", sortOrders: [5, 2, 9], expected: 10 },
  ];
  for (const { name, sortOrders, expected } of cases) {
    test(name, () => {
      expect(nextMacroSortOrder(sortOrders)).toBe(expected);
    });
  }
});

describe("macroOrderChanges", () => {
  const cases: Array<{
    name: string;
    order: string[];
    current: Array<[string, number]>;
    expected: Array<{ id: string; sortOrder: number }>;
  }> = [
    {
      name: "only the macros that moved",
      order: ["b", "a", "c"],
      current: [
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ],
      expected: [
        { id: "b", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
      ],
    },
    {
      name: "nothing for the order already stored",
      order: ["a", "b"],
      current: [
        ["a", 0],
        ["b", 1],
      ],
      expected: [],
    },
    {
      name: "a macro deleted since is skipped",
      order: ["gone", "b", "a"],
      current: [
        ["a", 0],
        ["b", 1],
      ],
      expected: [{ id: "a", sortOrder: 2 }],
    },
    {
      name: "orders with gaps are compacted",
      order: ["a", "b"],
      current: [
        ["a", 4],
        ["b", 9],
      ],
      expected: [
        { id: "a", sortOrder: 0 },
        { id: "b", sortOrder: 1 },
      ],
    },
  ];
  for (const { name, order, current, expected } of cases) {
    test(name, () => {
      expect(macroOrderChanges(order, new Map(current))).toEqual(expected);
    });
  }
});

describe("compareMacroOrder", () => {
  test("sorts by order, then by id", () => {
    const macros = [
      { id: "c", sortOrder: 1 },
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
    ];
    expect([...macros].sort(compareMacroOrder).map((macro) => macro.id)).toEqual(["b", "a", "c"]);
  });
});
