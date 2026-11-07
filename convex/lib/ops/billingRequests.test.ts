import { describe, expect, test } from "bun:test";
import { parseDiscountRequest, parseExemptionRequest, parsePlanRequest, parseSuspendRequest } from "./billingRequests";

describe("parsePlanRequest", () => {
  const cases: Array<[string, unknown, ReturnType<typeof parsePlanRequest>["ok"]]> = [
    ["a tier", { plan: "pro" }, true],
    ["not a tier", { plan: "enterprise" }, false],
    ["an extra field", { plan: "pro", seats: 3 }, false],
    ["not an object", ["pro"], false],
  ];
  for (const [name, body, ok] of cases) {
    test(name, () => {
      expect(parsePlanRequest(body).ok).toBe(ok);
    });
  }
});

describe("parseExemptionRequest", () => {
  test("a grant with and without an end", () => {
    expect(parseExemptionRequest({ plan: "pro", until: 1_800_000_000_000 })).toEqual({
      ok: true,
      value: { kind: "grant", plan: "pro", until: 1_800_000_000_000 },
    });
    expect(parseExemptionRequest({ plan: "starter" })).toEqual({
      ok: true,
      value: { kind: "grant", plan: "starter", until: null },
    });
  });

  test("a revoke", () => {
    expect(parseExemptionRequest({ revoke: true })).toEqual({ ok: true, value: { kind: "revoke" } });
  });

  const refused: Array<[string, unknown]> = [
    ["revoke false", { revoke: false }],
    ["revoke with a plan", { revoke: true, plan: "pro" }],
    ["an ISO date", { plan: "pro", until: "2027-03-01" }],
    ["a fractional time", { plan: "pro", until: 1.5 }],
    ["no plan", { until: 1 }],
  ];
  for (const [name, body] of refused) {
    test(`refuses ${name}`, () => {
      expect(parseExemptionRequest(body).ok).toBe(false);
    });
  }
});

describe("parseSuspendRequest", () => {
  test("needs a reason", () => {
    expect(parseSuspendRequest({ reason: " chargeback " })).toEqual({ ok: true, value: { reason: "chargeback" } });
    expect(parseSuspendRequest({ reason: "  " })).toEqual({ ok: false, message: "reason must be a non-empty string" });
    expect(parseSuspendRequest({})).toEqual({ ok: false, message: "reason must be a non-empty string" });
  });
});

describe("parseDiscountRequest", () => {
  const accepted: Array<[string, unknown]> = [
    ["percent once", { kind: "percent_off", percent: 50, duration: { kind: "once" } }],
    [
      "amount for 3 months",
      { kind: "amount_off", amountCents: 3000, currency: "usd", duration: { kind: "months", months: 3 } },
    ],
    ["percent forever", { kind: "percent_off", percent: 100, duration: { kind: "forever" } }],
  ];
  for (const [name, spec] of accepted) {
    test(`accepts ${name}`, () => {
      expect(parseDiscountRequest({ key: "spring", spec })).toEqual({ ok: true, value: { key: "spring", spec } });
    });
  }

  const refused: Array<[string, unknown]> = [
    ["a bad key", { key: "Spring Sale", spec: { kind: "percent_off", percent: 10, duration: { kind: "once" } } }],
    ["zero percent", { key: "k", spec: { kind: "percent_off", percent: 0, duration: { kind: "once" } } }],
    ["over 100 percent", { key: "k", spec: { kind: "percent_off", percent: 101, duration: { kind: "once" } } }],
    [
      "fractional cents",
      { key: "k", spec: { kind: "amount_off", amountCents: 1.5, currency: "usd", duration: { kind: "once" } } },
    ],
    [
      "another currency",
      { key: "k", spec: { kind: "amount_off", amountCents: 100, currency: "eur", duration: { kind: "once" } } },
    ],
    ["zero months", { key: "k", spec: { kind: "percent_off", percent: 10, duration: { kind: "months", months: 0 } } }],
    ["an unknown duration", { key: "k", spec: { kind: "percent_off", percent: 10, duration: { kind: "weekly" } } }],
  ];
  for (const [name, body] of refused) {
    test(`refuses ${name}`, () => {
      expect(parseDiscountRequest(body).ok).toBe(false);
    });
  }
});
