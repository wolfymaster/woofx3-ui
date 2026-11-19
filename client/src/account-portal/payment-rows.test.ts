import { describe, expect, test } from "bun:test";
import type { Invoice, Sponsorship } from "@convex/lib/billingClient";
import { invoiceRows, sponsorshipRows } from "./payment-rows";

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

describe("sponsorshipRows", () => {
  test("lists every sponsor payment, newest first, with distinct ids", () => {
    const rows = sponsorshipRows([sponsorship]);
    expect(rows.map((row) => row.dateMs)).toEqual([3_000, 1_000]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });
});

describe("invoiceRows", () => {
  test("dates an invoice by its period start", () => {
    expect(invoiceRows([invoice]).map((row) => [row.dateMs, row.url])).toEqual([[2_000, "https://i"]]);
  });
});
