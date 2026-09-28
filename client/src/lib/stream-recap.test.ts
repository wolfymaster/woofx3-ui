import { describe, expect, it } from "bun:test";
import type { RecapSupporter } from "@convex/lib/streamRecap";
import { buildThankYouMessage, buildViewerSeries, segmentTimeline } from "./stream-recap";
import { sessionIdFromParam, streamRecapPath } from "./stream-recap-route";

const T0 = Date.parse("2026-09-20T00:00:00.000Z");
const minute = (n: number) => new Date(T0 + n * 60_000).toISOString();

function supporter(userName: string | null, total: number): RecapSupporter {
  return { platformUserId: `id-${userName ?? total}`, userName, total, events: 1 };
}

describe("streamRecapPath", () => {
  it("encodes the session id", () => {
    expect(streamRecapPath("a/b")).toBe("/stream/recaps/a%2Fb");
  });

  it("round-trips through the route param", () => {
    expect(sessionIdFromParam("a%2Fb")).toBe("a/b");
    expect(sessionIdFromParam("%E0%A4%A")).toBe("%E0%A4%A");
    expect(sessionIdFromParam(undefined)).toBe("");
  });
});

describe("segmentTimeline", () => {
  it("places segments along the span from first start to last end", () => {
    const timeline = segmentTimeline([
      { id: "b", startedAt: minute(90), endedAt: minute(120) },
      { id: "a", startedAt: minute(0), endedAt: minute(60) },
    ]);
    expect(timeline.map((s) => s.id)).toEqual(["a", "b"]);
    expect(timeline[0].offsetPercent).toBe(0);
    expect(timeline[0].widthPercent).toBe(50);
    expect(timeline[1].offsetPercent).toBe(75);
    expect(timeline[1].widthPercent).toBe(25);
  });

  it("leaves out a segment with no end", () => {
    const timeline = segmentTimeline([
      { id: "a", startedAt: minute(0), endedAt: minute(10) },
      { id: "b", startedAt: minute(20), endedAt: null },
    ]);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].widthPercent).toBe(100);
  });

  it("is empty for a session that was never live", () => {
    expect(segmentTimeline([])).toEqual([]);
  });
});

describe("buildViewerSeries", () => {
  const segments = [{ id: "s", startedAt: minute(0), endedAt: minute(10) }];

  it("breaks the line at an unsampled minute instead of drawing zero", () => {
    const { points } = buildViewerSeries(
      [
        { sampledAt: minute(1), viewerCount: 10 },
        { sampledAt: minute(2), viewerCount: 12 },
        { sampledAt: minute(5), viewerCount: 20 },
        { sampledAt: minute(6), viewerCount: 22 },
      ],
      segments
    );
    expect(points.map((p) => p.viewers)).toEqual([10, 12, null, 20, 22]);
    expect(points[2].t).toBe(T0 + 3 * 60_000);
    expect(points.every((p) => p.viewers !== 0)).toBe(true);
  });

  it("keeps a failed read as a gap", () => {
    const { points } = buildViewerSeries(
      [
        { sampledAt: minute(1), viewerCount: 10 },
        { sampledAt: minute(2), viewerCount: null },
        { sampledAt: minute(3), viewerCount: 14 },
      ],
      segments
    );
    expect(points.map((p) => p.viewers)).toEqual([10, null, 14]);
    expect(points.map((p) => p.isolated)).toEqual([true, false, true]);
  });

  it("marks only values with no sampled neighbour as isolated", () => {
    const { points } = buildViewerSeries(
      [
        { sampledAt: minute(1), viewerCount: 10 },
        { sampledAt: minute(2), viewerCount: 11 },
        { sampledAt: minute(7), viewerCount: 30 },
      ],
      segments
    );
    expect(points.filter((p) => p.isolated).map((p) => p.viewers)).toEqual([30]);
  });

  it("orders samples and keeps one per minute", () => {
    const { points } = buildViewerSeries(
      [
        { sampledAt: minute(2), viewerCount: 5 },
        { sampledAt: new Date(T0 + 60_000 + 30_000).toISOString(), viewerCount: 4 },
        { sampledAt: minute(1), viewerCount: 3 },
      ],
      segments
    );
    expect(points.map((p) => p.viewers)).toEqual([3, 5]);
  });

  it("spans the live segments even where nothing was sampled", () => {
    const { domain } = buildViewerSeries([{ sampledAt: minute(4), viewerCount: 9 }], segments);
    expect(domain).toEqual([T0, T0 + 10 * 60_000]);
  });

  it("has no points and no domain with no samples and no segments", () => {
    expect(buildViewerSeries([], [])).toEqual({ points: [], domain: null });
  });
});

describe("buildThankYouMessage", () => {
  it("names the top gifters and cheerers", () => {
    const message = buildThankYouMessage({
      gifters: [supporter("alice", 5), supporter("bob", 1)],
      cheerers: [supporter("carol", 1500)],
    });
    expect(message).toBe(
      "Thank you for an amazing stream! Top gifters: @alice (5 subs), @bob (1 sub). Top cheerers: @carol (1,500 bits). You all made it happen <3"
    );
  });

  it("leaves out a list with nobody named and supporters without a name", () => {
    const message = buildThankYouMessage({
      gifters: [supporter(null, 10)],
      cheerers: [supporter("dave", 1), supporter(" ", 100)],
    });
    expect(message).toBe("Thank you for an amazing stream! Top cheerers: @dave (1 bit). You all made it happen <3");
  });

  it("is null when there is no one to thank", () => {
    expect(buildThankYouMessage({ gifters: [], cheerers: [supporter(null, 100)] })).toBeNull();
  });

  it("names at most three per list", () => {
    const names = ["a", "b", "c", "d", "e"];
    const message = buildThankYouMessage({ gifters: names.map((n, i) => supporter(n, 10 - i)), cheerers: [] });
    expect(message).toContain("@c (8 subs)");
    expect(message).not.toContain("@d");
  });

  it("drops the lowest-ranked names until the line fits", () => {
    const long = (prefix: string) => `${prefix}${"x".repeat(20)}`;
    const supporters = {
      gifters: [supporter(long("g1"), 3), supporter(long("g2"), 2), supporter(long("g3"), 1)],
      cheerers: [supporter(long("c1"), 300), supporter(long("c2"), 200)],
    };
    const message = buildThankYouMessage(supporters, 160);
    expect(message).not.toBeNull();
    expect((message as string).length).toBeLessThanOrEqual(160);
    expect(message).toContain(`@${long("g1")}`);
    expect(message).toContain(`@${long("c1")}`);
    expect(message).not.toContain(`@${long("g3")}`);
  });

  it("is null when even one name cannot fit", () => {
    expect(buildThankYouMessage({ gifters: [supporter("alice", 1)], cheerers: [] }, 20)).toBeNull();
  });
});
