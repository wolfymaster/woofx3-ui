import { describe, expect, test } from "bun:test";
import type { Sponsorship } from "@convex/lib/billingClient";
import { formatDay } from "@/billing/format";
import { stateLabel } from "./sponsorship-text";

const END = Date.parse("2026-12-01T12:00:00Z");
const base: Sponsorship = {
  id: "sp1",
  interval: "month",
  amountCents: 25_000,
  currency: "usd",
  state: "active",
  cancelAtPeriodEnd: false,
  currentPeriodEnd: END,
  createdAt: 1,
  payments: [],
};

describe("stateLabel", () => {
  test.each([
    ["an active sponsorship", base, "Active"],
    ["one set to end", { ...base, cancelAtPeriodEnd: true }, `Ending ${formatDay(END)}`],
    [
      "a past-due one set to end",
      { ...base, state: "past_due" as const, cancelAtPeriodEnd: true },
      `Ending ${formatDay(END)}`,
    ],
    ["one already canceled", { ...base, state: "canceled" as const, cancelAtPeriodEnd: true }, "Canceled"],
    ["a set-to-end one with no end date", { ...base, cancelAtPeriodEnd: true, currentPeriodEnd: null }, "Active"],
    ["a paid one-time sponsorship", { ...base, interval: "once" as const, state: "complete" as const }, "Paid"],
  ])("%s", (_name, sponsorship, expected) => {
    expect(stateLabel(sponsorship)).toBe(expected);
  });
});
