import { describe, expect, test } from "bun:test";
import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import { filterRows, hasBothKinds, paymentRows } from "./payment-rows";

const invoice: Invoice = { id: "in1", periodStart: 2_000, amountCents: 6_000, status: "paid", hostedUrl: "https://i" };
const sponsorship: Sponsorship = {
  id: "sp1",
  interval: "month",
  amountCents: 25_000,
  currency: "usd",
  state: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  createdAt: 1_000,
  payments: [
    { id: "p1", amountCents: 25_000, status: "paid", paidAt: 1_000, receiptUrl: null },
    { id: "p2", amountCents: 25_000, status: "paid", paidAt: 3_000, receiptUrl: "https://r" },
  ],
};

describe("paymentRows", () => {
  test("merges both kinds, newest first, with distinct ids", () => {
    const rows = paymentRows([invoice], [sponsorship]);
    expect(rows.map((row) => [row.kind, row.dateMs])).toEqual([
      ["sponsorship", 3_000],
      ["plan", 2_000],
      ["sponsorship", 1_000],
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  test("a viewer with no invoices sees sponsor rows alone", () => {
    const rows = paymentRows([], [sponsorship]);
    expect(rows.every((row) => row.kind === "sponsorship")).toBe(true);
    expect(hasBothKinds(rows)).toBe(false);
  });
});

describe("hasBothKinds and filterRows", () => {
  const rows = paymentRows([invoice], [sponsorship]);

  test("the filter is offered only when both kinds exist", () => {
    expect(hasBothKinds(rows)).toBe(true);
    expect(hasBothKinds(paymentRows([invoice], []))).toBe(false);
    expect(hasBothKinds([])).toBe(false);
  });

  test.each([
    ["all" as const, 3],
    ["plan" as const, 1],
    ["sponsorship" as const, 2],
  ])("%s", (filter, count) => {
    expect(filterRows(rows, filter)).toHaveLength(count);
  });
});
