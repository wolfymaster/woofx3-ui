import { describe, expect, it } from "bun:test";
import { formatLiveDuration, formatViewerFigure, liveDurationMs } from "./session-summary";

describe("liveDurationMs", () => {
  it("adds up segments and skips the gaps between them", () => {
    const ms = liveDurationMs([
      { startedAt: "2026-09-20T00:00:00.000Z", endedAt: "2026-09-20T01:00:00.000Z" },
      { startedAt: "2026-09-20T02:00:00.000Z", endedAt: "2026-09-20T02:30:00.000Z" },
    ]);
    expect(ms).toBe(90 * 60_000);
  });

  it("is zero for a session that was never live", () => {
    expect(liveDurationMs([])).toBe(0);
  });

  it("ignores a segment with no end", () => {
    expect(liveDurationMs([{ startedAt: "2026-09-20T00:00:00.000Z", endedAt: null }])).toBe(0);
  });
});

describe("formatLiveDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatLiveDuration(30_000)).toBe("<1m");
    expect(formatLiveDuration(42 * 60_000)).toBe("42m");
    expect(formatLiveDuration(185 * 60_000)).toBe("3h 05m");
  });
});

describe("formatViewerFigure", () => {
  it("shows a dash when nothing was sampled", () => {
    expect(formatViewerFigure(null)).toBe("—");
    expect(formatViewerFigure(0)).toBe("0");
    expect(formatViewerFigure(61.5)).toBe("62");
  });
});
