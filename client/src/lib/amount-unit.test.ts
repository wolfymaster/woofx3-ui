import { describe, expect, test } from "bun:test";
import { formatAmount, unitFor } from "./amount-unit";

describe("unitFor", () => {
  test("makes a plural unit singular for exactly 1", () => {
    expect(unitFor(1, "bits")).toBe("bit");
    expect(unitFor(1, "months")).toBe("month");
    expect(unitFor(1, "viewers")).toBe("viewer");
    expect(unitFor(1, "gifted subs")).toBe("gifted sub");
    expect(unitFor(1, "entries")).toBe("entry");
    expect(unitFor(1, "boxes")).toBe("box");
  });

  test("keeps the plural for any other amount", () => {
    expect(unitFor(0, "bits")).toBe("bits");
    expect(unitFor(2, "bits")).toBe("bits");
    expect(unitFor(1.5, "months")).toBe("months");
  });

  test("leaves abbreviations and words that are not plurals alone", () => {
    expect(unitFor(1, "ms")).toBe("ms");
    expect(unitFor(1, "s")).toBe("s");
    expect(unitFor(1, "class")).toBe("class");
    expect(unitFor(1, "%")).toBe("%");
  });
});

describe("formatAmount", () => {
  test("reads an amount with its unit", () => {
    expect(formatAmount(1, "subs")).toBe("1 sub");
    expect(formatAmount(1000, "bits")).toBe("1,000 bits");
    expect(formatAmount(5)).toBe("5");
  });
});
