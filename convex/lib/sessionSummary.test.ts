import { describe, expect, it } from "bun:test";
import {
  type ParsedSessionSummary,
  parseSessionSummary,
  planSummaryWrite,
  SESSION_SUMMARY_EVENT_TYPE,
  summaryColumns,
} from "./sessionSummary";

function summaryBody(overrides: Record<string, unknown> = {}) {
  return {
    type: SESSION_SUMMARY_EVENT_TYPE,
    sessionId: "session-1",
    schemaVersion: 1,
    generatedAt: "2026-09-20T04:00:00.000Z",
    session: {
      id: "session-1",
      status: "closed",
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T03:00:00.000Z",
      segments: [
        { id: "segment-1", startedAt: "2026-09-20T00:00:00.000Z", endedAt: "2026-09-20T01:00:00.000Z" },
        { id: "segment-2", startedAt: "2026-09-20T01:05:00.000Z", endedAt: "2026-09-20T03:00:00.000Z" },
      ],
    },
    totals: {
      bits: 500,
      cheers: 3,
      subs: 4,
      giftedSubs: 10,
      follows: 12,
      raids: 1,
      raiders: 42,
      peakViewers: 88,
      averageViewers: 61.5,
      viewerSampleMinutes: 170,
    },
    ...overrides,
  };
}

function parsed(body: unknown): ParsedSessionSummary {
  const result = parseSessionSummary(body);
  if (!result.ok) {
    throw new Error(`expected a valid summary, got: ${result.reason}`);
  }
  return result.summary;
}

describe("parseSessionSummary", () => {
  it("accepts a full summary and copies out its session and totals", () => {
    const summary = parsed(summaryBody());
    expect(summary.sessionId).toBe("session-1");
    expect(summary.generatedAtMs).toBe(Date.parse("2026-09-20T04:00:00.000Z"));
    expect(summary.body?.session.segments).toHaveLength(2);
    expect(summary.body?.totals.averageViewers).toBe(61.5);
  });

  it("accepts a session that was never live as an all-zero summary", () => {
    const summary = parsed(
      summaryBody({
        session: {
          id: "session-1",
          status: "closed",
          startedAt: "2026-09-20T00:00:00.000Z",
          endedAt: "2026-09-20T00:00:00.000Z",
          segments: [],
        },
        totals: {
          bits: 0,
          cheers: 0,
          subs: 0,
          giftedSubs: 0,
          follows: 0,
          raids: 0,
          raiders: 0,
          peakViewers: null,
          averageViewers: null,
          viewerSampleMinutes: 0,
        },
      })
    );
    expect(summary.body?.session.segments).toEqual([]);
    expect(summary.body?.totals.peakViewers).toBeNull();
    expect(summary.body?.totals.follows).toBe(0);
  });

  it("drops fields the contract does not list", () => {
    const body = summaryBody();
    const summary = parsed({ ...body, totals: { ...body.totals, topCheerer: "someone" }, extra: true });
    expect(Object.keys(summary.body?.totals ?? {})).not.toContain("topCheerer");
    expect(Object.keys(summary)).not.toContain("extra");
  });

  it("rejects a session whose id disagrees with sessionId", () => {
    const body = summaryBody();
    const result = parseSessionSummary({ ...body, session: { ...body.session, id: "session-2" } });
    expect(result).toEqual({ ok: false, reason: "session.id does not equal sessionId" });
  });

  it("rejects an unreadable generatedAt, since it is what orders repeats", () => {
    const result = parseSessionSummary(summaryBody({ generatedAt: "yesterday-ish" }));
    expect(result).toEqual({ ok: false, reason: "generatedAt is not a timestamp" });
  });

  it("rejects a negative or fractional count", () => {
    const body = summaryBody();
    expect(parseSessionSummary({ ...body, totals: { ...body.totals, bits: -1 } }).ok).toBe(false);
    expect(parseSessionSummary({ ...body, totals: { ...body.totals, follows: 1.5 } }).ok).toBe(false);
  });

  it("rejects a malformed segment", () => {
    const body = summaryBody();
    const result = parseSessionSummary({
      ...body,
      session: { ...body.session, segments: [{ id: "segment-1", startedAt: 5, endedAt: null }] },
    });
    expect(result).toEqual({ ok: false, reason: "session.segments[0].startedAt is not a timestamp" });
  });

  it("rejects a missing sessionId and a wrong type", () => {
    expect(parseSessionSummary(summaryBody({ sessionId: "" })).ok).toBe(false);
    expect(parseSessionSummary(summaryBody({ type: "session.started" })).ok).toBe(false);
    expect(parseSessionSummary(null).ok).toBe(false);
  });

  it("keeps an unknown schemaVersion without interpreting its fields", () => {
    const summary = parsed(summaryBody({ schemaVersion: 2, totals: { renamed: true } }));
    expect(summary.schemaVersion).toBe(2);
    expect(summary.body).toBeNull();
  });
});

describe("summaryColumns", () => {
  it("lifts the session start out for listing and keeps no raw payload for a known version", () => {
    const columns = summaryColumns(parsed(summaryBody()), "{}");
    expect(columns.sessionStartedAtMs).toBe(Date.parse("2026-09-20T00:00:00.000Z"));
    expect(columns.rawPayload).toBeUndefined();
    expect(columns.totals?.giftedSubs).toBe(10);
  });

  it("keeps only the raw payload for an unknown version", () => {
    const columns = summaryColumns(parsed(summaryBody({ schemaVersion: 2 })), '{"raw":true}');
    expect(columns.rawPayload).toBe('{"raw":true}');
    expect(columns.session).toBeUndefined();
    expect(columns.totals).toBeUndefined();
    expect(columns.sessionStartedAtMs).toBeUndefined();
  });
});

describe("planSummaryWrite", () => {
  it("inserts when nothing is stored", () => {
    expect(planSummaryWrite(null, 1000)).toBe("insert");
  });

  it("replaces a stored snapshot only with a strictly newer one", () => {
    expect(planSummaryWrite({ generatedAtMs: 1000 }, 2000)).toBe("replace");
    expect(planSummaryWrite({ generatedAtMs: 1000 }, 1000)).toBe("stale");
    expect(planSummaryWrite({ generatedAtMs: 2000 }, 1000)).toBe("stale");
  });

  // Plays deliveries through the same decision the mutation makes, against a
  // store keyed the same way, to show the end state depends only on which
  // snapshot is newest and never on arrival order or repeats.
  function deliver(bodies: ReturnType<typeof summaryBody>[]) {
    const store = new Map<string, { generatedAtMs: number; follows: number | undefined }>();
    for (const body of bodies) {
      const summary = parsed(body);
      const stored = store.get(summary.sessionId) ?? null;
      if (planSummaryWrite(stored, summary.generatedAtMs) !== "stale") {
        store.set(summary.sessionId, {
          generatedAtMs: summary.generatedAtMs,
          follows: summary.body?.totals.follows,
        });
      }
    }
    return store;
  }

  function withFollows(generatedAt: string, follows: number) {
    const body = summaryBody({ generatedAt });
    return { ...body, totals: { ...body.totals, follows } };
  }

  it("ends on the newest snapshot whatever order deliveries arrive in", () => {
    const first = withFollows("2026-09-20T04:00:00.000Z", 12);
    const resummary = withFollows("2026-09-21T09:00:00.000Z", 15);

    const inOrder = deliver([first, resummary]);
    const lateOriginal = deliver([resummary, first]);
    const redelivered = deliver([first, resummary, first, resummary]);

    for (const store of [inOrder, lateOriginal, redelivered]) {
      expect(store.size).toBe(1);
      expect(store.get("session-1")?.follows).toBe(15);
    }
  });

  it("compares instants, not strings, so offsets and precision do not reorder", () => {
    const utc = withFollows("2026-09-20T04:00:00.000Z", 12);
    const laterWithOffset = withFollows("2026-09-19T23:30:00-05:00", 20);
    expect(deliver([laterWithOffset, utc]).get("session-1")?.follows).toBe(20);
  });
});
