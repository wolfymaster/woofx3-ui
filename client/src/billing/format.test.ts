import { describe, expect, test } from "bun:test";
import type { AppliedDiscount, PlanPrice } from "@convex/lib/billingClient";
import { describeDiscount, formatPrice, formatSeats, PRICE_UNAVAILABLE_TEXT, planName } from "./format";

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
  const prices: PlanPrice[] = [
    { plan: "starter", interval: "month", amountCents: 7_500, currency: "usd" },
    { plan: "pro", interval: "year", amountCents: 129_900, currency: "usd" },
  ];

  test("shows the plane's price, drops whole cents and names the interval", () => {
    expect(formatPrice(prices, "starter", "month")).toBe("$75/mo");
    expect(formatPrice(prices, "pro", "year")).toBe("$1,299/yr");
  });

  test("keeps cents that are not whole", () => {
    const odd: PlanPrice[] = [{ plan: "pro", interval: "month", amountCents: 1_250, currency: "usd" }];
    expect(formatPrice(odd, "pro", "month")).toBe("$12.50/mo");
  });

  test("says unavailable when the plane has not answered or lacks that price", () => {
    expect(formatPrice(null, "starter", "month")).toBe(PRICE_UNAVAILABLE_TEXT);
    expect(formatPrice(prices, "pro", "month")).toBe(PRICE_UNAVAILABLE_TEXT);
  });
});

describe("planName", () => {
  test("is the plan row's name, or the key before the rows load", () => {
    expect(planName({ starter: "Starter Plus" }, "starter")).toBe("Starter Plus");
    expect(planName({}, "pro")).toBe("pro");
  });
});

describe("formatSeats", () => {
  const cases: Array<[{ used: number; limit: number | null }, string]> = [
    [{ used: 3, limit: 5 }, "3 of 5 seats used"],
    [{ used: 20, limit: null }, "20 members"],
    [{ used: 1, limit: null }, "1 member"],
  ];
  for (const [seats, expected] of cases) {
    test(expected, () => {
      expect(formatSeats(seats)).toBe(expected);
    });
  }
});
