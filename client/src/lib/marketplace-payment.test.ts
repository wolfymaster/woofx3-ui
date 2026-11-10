import { describe, expect, test } from "bun:test";
import type { MarketplaceCheckout } from "@/engine/types";
import { type PaymentStart, paymentStartFromCheckout } from "./marketplace-payment";

describe("paymentStartFromCheckout", () => {
  const cases: { checkout: MarketplaceCheckout; expected: PaymentStart }[] = [
    {
      checkout: { status: "redirect", url: "https://pay.example/s/1" },
      expected: { status: "redirect", url: "https://pay.example/s/1" },
    },
    { checkout: { status: "already_entitled" }, expected: { status: "settled" } },
    { checkout: { status: "no_payment_needed" }, expected: { status: "settled" } },
    {
      checkout: { status: "unavailable", message: "no purchases here" },
      expected: { status: "unavailable", message: "no purchases here" },
    },
  ];
  for (const { checkout, expected } of cases) {
    test(`${checkout.status} starts as ${expected.status}`, () => {
      expect(paymentStartFromCheckout(checkout)).toEqual(expected);
    });
  }
});
