import { describe, expect, test } from "bun:test";
import { amountProblem, DEFAULT_SPONSORSHIP, dollarsText, parseDollars, prefillFromSearch } from "./amount";

const TERMS = { minCents: 10_000, maxCents: 100_000, currency: "usd" };

describe("parseDollars", () => {
  test.each([
    ["250", 25_000],
    ["250.5", 25_050],
    ["$1,000.00", 100_000],
    [" 100 ", 10_000],
    ["", null],
    ["abc", null],
    ["1.234", null],
    ["-5", null],
    ["1e3", null],
  ])("%p", (text, expected) => {
    expect(parseDollars(text)).toBe(expected);
  });
});

describe("dollarsText", () => {
  test.each([
    [25_000, "250"],
    [25_050, "250.50"],
  ])("%p", (cents, expected) => {
    expect(dollarsText(cents)).toBe(expected);
  });
});

describe("amountProblem", () => {
  test.each([
    [null, "Enter an amount in dollars, like 250 or 250.50."],
    [9_999, "The minimum is $100.00."],
    [10_000, null],
    [100_000, null],
    [100_001, "The maximum is $1,000.00."],
  ])("%p", (cents, expected) => {
    expect(amountProblem(cents, TERMS)).toBe(expected);
  });
});

describe("prefillFromSearch", () => {
  test.each([
    ["?amountCents=50000&interval=once", { amountCents: 50_000, interval: "once" }],
    ["amountCents=10000", { amountCents: 10_000, interval: "month" }],
    ["", DEFAULT_SPONSORSHIP],
    ["?amountCents=abc&interval=weekly", DEFAULT_SPONSORSHIP],
    ["?amountCents=-5", DEFAULT_SPONSORSHIP],
    ["?amountCents=0", DEFAULT_SPONSORSHIP],
    ["?amountCents=12.5", DEFAULT_SPONSORSHIP],
    ["?amountCents=99999999999999999999", DEFAULT_SPONSORSHIP],
    ["?amountCents=1&amountCents=2", { amountCents: 1, interval: "month" }],
  ])("%p", (search, expected) => {
    expect(prefillFromSearch(search)).toEqual(expected);
  });
});
