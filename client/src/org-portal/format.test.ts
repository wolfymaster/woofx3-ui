import { describe, expect, test } from "bun:test";
import type { AppliedDiscount } from "@convex/lib/payments/provider";
import { describeDiscount, formatPrice } from "./format";

describe("describeDiscount", () => {
  const cases: Array<[AppliedDiscount["spec"], string]> = [
    [{ kind: "percent_off", percent: 50, duration: { kind: "months", months: 3 } }, "50% off for 3 months"],
    [{ kind: "percent_off", percent: 10, duration: { kind: "months", months: 1 } }, "10% off for 1 month"],
    [{ kind: "amount_off", amountCents: 1000, currency: "usd", duration: { kind: "once" } }, "off on the next payment"],
    [{ kind: "percent_off", percent: 20, duration: { kind: "forever" } }, "20% off on every payment"],
  ];
  for (const [spec, expected] of cases) {
    test(expected, () => {
      expect(describeDiscount({ spec, code: null, endsAt: null })).toContain(expected);
    });
  }
});

describe("formatPrice", () => {
  test("drops whole cents and names the interval", () => {
    expect(formatPrice("starter", "month")).toContain("/mo");
    expect(formatPrice("pro", "year")).toContain("/yr");
  });
});
