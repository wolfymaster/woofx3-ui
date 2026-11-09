import { describe, expect, test } from "bun:test";
import { dateText } from "./dateText";

describe("dateText", () => {
  const cases: Array<[string, string, string]> = [
    ["winter, PST", "2026-11-23T00:00:00.000Z", "November 22, 2026 at 4:00 PM PST"],
    ["a single-digit day in winter", "2026-02-05T20:30:00.000Z", "February 5, 2026 at 12:30 PM PST"],
    ["summer, PDT", "2026-07-15T19:00:00.000Z", "July 15, 2026 at 12:00 PM PDT"],
    ["just before spring forward", "2026-03-08T09:59:59.000Z", "March 8, 2026 at 1:59 AM PST"],
    ["spring forward moment", "2026-03-08T10:00:00.000Z", "March 8, 2026 at 3:00 AM PDT"],
    ["just before fall back", "2026-11-01T08:59:59.000Z", "November 1, 2026 at 1:59 AM PDT"],
    ["fall back moment", "2026-11-01T09:00:00.000Z", "November 1, 2026 at 1:00 AM PST"],
    ["midnight UTC is the previous Pacific day", "2026-07-01T00:00:00.000Z", "June 30, 2026 at 5:00 PM PDT"],
    ["end of the year in Pacific time", "2026-12-31T23:59:59.000Z", "December 31, 2026 at 3:59 PM PST"],
    ["the new year arrives eight hours after UTC", "2027-01-01T08:00:00.000Z", "January 1, 2027 at 12:00 AM PST"],
  ];
  for (const [name, iso, expected] of cases) {
    test(name, () => {
      expect(dateText(Date.parse(iso))).toBe(expected);
    });
  }
});
