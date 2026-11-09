import { describe, expect, test } from "bun:test";
import { dateText } from "./dateText";

describe("dateText", () => {
  const cases: Array<[string, string, string]> = [
    ["a mid-month day", "2026-11-23T00:00:00.000Z", "November 23, 2026"],
    ["a single-digit day without padding", "2026-03-05T12:00:00.000Z", "March 5, 2026"],
    ["the last moment of the year", "2026-12-31T23:59:59.999Z", "December 31, 2026"],
    ["the first moment of the year", "2027-01-01T00:00:00.000Z", "January 1, 2027"],
    ["midnight UTC stays on its own day", "2026-07-01T00:00:00.000Z", "July 1, 2026"],
    ["a leap day", "2028-02-29T08:30:00.000Z", "February 29, 2028"],
  ];
  for (const [name, iso, expected] of cases) {
    test(name, () => {
      expect(dateText(Date.parse(iso))).toBe(expected);
    });
  }
});
