import { describe, expect, test } from "bun:test";
import { formatTimeAgo } from "./time-ago";

const now = Date.parse("2026-01-02T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatTimeAgo", () => {
  test("steps up a unit at each boundary", () => {
    expect(formatTimeAgo(ago(5_000), now)).toBe("5s ago");
    expect(formatTimeAgo(ago(90_000), now)).toBe("1m ago");
    expect(formatTimeAgo(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(formatTimeAgo(ago(50 * 3_600_000), now)).toBe("2d ago");
  });

  // Clocks disagree: an engine timestamp a second into the future should read
  // as just now, not as a negative age.
  test("clamps a timestamp from the future to zero", () => {
    expect(formatTimeAgo(ago(-5_000), now)).toBe("0s ago");
  });

  test("says nothing at all about a missing or unreadable timestamp", () => {
    expect(formatTimeAgo(undefined, now)).toBe("");
    expect(formatTimeAgo("whenever", now)).toBe("");
  });
});
