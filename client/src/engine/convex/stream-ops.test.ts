import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: a gateway
// request must send what the recap hooks, the supporters page and the
// test-event hook sent before.

const calls: Array<{ name: string; args: unknown }> = [];
const queries: Array<{ name: string; args: unknown }> = [];
let rows: Record<string, unknown> = {};
let answers: Record<string, unknown> = {};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    const name = getFunctionName(action);
    calls.push({ name, args });
    const answer = answers[name];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? null);
  },
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(query);
    queries.push({ name, args });
    return rows[name];
  },
}));

const { convexStreamOpsGateway, toStreamRecap } = await import("./stream-ops");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
  queries.length = 0;
  rows = {};
  answers = {};
});

const session = {
  status: "closed" as const,
  startedAt: "2026-10-27T10:00:00Z",
  endedAt: "2026-10-27T12:00:00Z",
  segments: [{ id: "seg-1", startedAt: "2026-10-27T10:05:00Z", endedAt: "2026-10-27T11:55:00Z" }],
};
const totals = {
  bits: 300,
  cheers: 3,
  subs: 4,
  giftedSubs: 5,
  follows: 6,
  raids: 1,
  raiders: 40,
  peakViewers: 50,
  averageViewers: null,
  viewerSampleMinutes: 0,
};
const summaryRow = {
  _id: "summary-1",
  _creationTime: 1,
  instanceId,
  sessionId: "session-1",
  schemaVersion: 1,
  generatedAt: "2026-10-27T12:00:01Z",
  generatedAtMs: Date.parse("2026-10-27T12:00:01Z"),
  sessionStartedAtMs: Date.parse(session.startedAt),
  session,
  totals,
  rawPayload: "{}",
  receivedAt: 2,
  inProgress: false,
};

describe("streamOps recaps", () => {
  test("a stored summary is a recap, with Convex's own fields gone", () => {
    expect(toStreamRecap(summaryRow as Parameters<typeof toStreamRecap>[0])).toEqual({
      sessionId: "session-1",
      generatedAt: "2026-10-27T12:00:01Z",
      generatedAtMs: Date.parse("2026-10-27T12:00:01Z"),
      inProgress: false,
      summary: { kind: "read", session, totals },
    });
  });

  test("a summary in a schema this deployment does not interpret keeps only its version", () => {
    const unread = { ...summaryRow, schemaVersion: 2, session: undefined, totals: undefined };
    expect(toStreamRecap(unread as Parameters<typeof toStreamRecap>[0]).summary).toEqual({
      kind: "unreadable",
      schemaVersion: 2,
    });
  });

  test("list and get read the stored summaries for the scope's instance", () => {
    rows = { "streamSessionSummaries:listRecent": [summaryRow], "streamSessionSummaries:get": null };
    const recent = renderInScope(() => convexStreamOpsGateway.useRecentRecaps(10));
    const missing = renderInScope(() => convexStreamOpsGateway.useRecap("session-2"));
    expect(recent?.map((recap) => recap.sessionId)).toEqual(["session-1"]);
    expect(missing).toBeNull();
    expect(queries).toEqual([
      { name: "streamSessionSummaries:listRecent", args: { instanceId, limit: 10 } },
      { name: "streamSessionSummaries:get", args: { instanceId, sessionId: "session-2" } },
    ]);
  });

  test("a read that is not enabled skips", () => {
    renderInScope(() => convexStreamOpsGateway.useRecap("session-1", { enabled: false }));
    expect(queries).toEqual([{ name: "streamSessionSummaries:get", args: "skip" }]);
  });

  test("clips and markers are asked of Twitch through Convex and come back as the gateway's records", async () => {
    const clip = {
      id: "clip-1",
      url: "https://clips.twitch.tv/clip-1",
      title: "Nice",
      creatorName: "mod",
      viewCount: 7,
      createdAt: "2026-10-27T10:30:00Z",
      thumbnailUrl: "https://example.test/clip-1.jpg",
      durationSeconds: 30,
      offsetMs: 1_500_000,
    };
    const marker = { id: "marker-1", createdAt: "2026-10-27T10:40:00Z", description: "boss fight" };
    answers = {
      "streamRecap:loadClips": { status: "ok", clips: [clip] },
      "streamRecap:loadMarkers": { status: "ok", markers: [marker] },
    };
    expect(convexStreamOpsGateway.support).toEqual({ recapClips: true, recapMarkers: true });
    const loadClips = renderInScope(() => convexStreamOpsGateway.useRecapClipsRequest());
    const loadMarkers = renderInScope(() => convexStreamOpsGateway.useRecapMarkersRequest());
    expect(await loadClips("session-1")).toEqual({ status: "ok", clips: [clip] });
    expect(await loadMarkers("session-1")).toEqual({ status: "ok", markers: [marker] });
    expect(calls).toEqual([
      { name: "streamRecap:loadClips", args: { instanceId, sessionId: "session-1" } },
      { name: "streamRecap:loadMarkers", args: { instanceId, sessionId: "session-1" } },
    ]);
  });

  test("a refusal Convex raised rejects as a plain error with its text", async () => {
    answers = { "streamRecap:loadMarkers": new ConvexError("There's no recap for this stream.") };
    const loadMarkers = renderInScope(() => convexStreamOpsGateway.useRecapMarkersRequest());
    const refusal = await loadMarkers("session-1").catch((error: unknown) => error);
    expect(refusal).not.toBeInstanceOf(ConvexError);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe("There's no recap for this stream.");
  });
});

describe("streamOps recap requests", () => {
  test("load a session's engine detail and timeline events", async () => {
    const loadDetail = renderInScope(() => convexStreamOpsGateway.useRecapEngineDetailRequest());
    const loadEvents = renderInScope(() => convexStreamOpsGateway.useRecapTimelineEventsRequest());
    await loadDetail("session-1");
    await loadEvents("session-1");
    expect(calls).toEqual([
      { name: "streamRecap:loadEngineDetail", args: { instanceId, sessionId: "session-1" } },
      { name: "streamRecap:loadTimelineEvents", args: { instanceId, sessionId: "session-1" } },
    ]);
  });

  test("refresh the open session", async () => {
    const refresh = renderInScope(() => convexStreamOpsGateway.useOpenSessionRefreshRequest());
    await refresh();
    expect(calls).toEqual([{ name: "streamRecap:refreshOpenSession", args: { instanceId } }]);
  });
});

describe("streamOps supporter requests", () => {
  test("list streams and read a stream's leaderboard", async () => {
    const listStreams = renderInScope(() => convexStreamOpsGateway.useSupporterStreamsRequest());
    const leaderboard = renderInScope(() => convexStreamOpsGateway.useSupporterLeaderboardRequest());
    await listStreams();
    await leaderboard({ metric: "bits", minTotal: 1, sessionId: "session-1" });
    expect(calls).toEqual([
      { name: "supporters:listStreams", args: { instanceId } },
      { name: "supporters:leaderboard", args: { instanceId, metric: "bits", minTotal: 1, sessionId: "session-1" } },
    ]);
  });

  test("sends no session for the all-time leaderboard", async () => {
    const leaderboard = renderInScope(() => convexStreamOpsGateway.useSupporterLeaderboardRequest());
    await leaderboard({ metric: "giftedSubs", minTotal: 5 });
    expect(calls[0]?.args).toEqual({ instanceId, metric: "giftedSubs", minTotal: 5 });
    expect(calls[0]?.args).not.toHaveProperty("sessionId");
  });

  test("read a viewer's totals", async () => {
    const viewerTotals = renderInScope(() => convexStreamOpsGateway.useViewerSupportTotalsRequest());
    await viewerTotals("1234");
    expect(calls).toEqual([{ name: "supporters:viewerTotals", args: { instanceId, platformUserId: "1234" } }]);
  });
});

describe("streamOps test events", () => {
  test("publish as given or simulate a Twitch event, with the same arguments", async () => {
    const publish = renderInScope(() => convexStreamOpsGateway.usePublishEventRequest());
    const simulate = renderInScope(() => convexStreamOpsGateway.useSimulateTwitchEventRequest());
    const event = { eventType: "user.follow", eventData: { user: "wolfy" }, triggerId: "key-1", triggeredBy: "test" };
    await publish(event);
    await simulate(event);
    expect(calls).toEqual([
      { name: "debug:fireTrigger", args: { instanceId, ...event } },
      { name: "debug:simulateTwitchEvent", args: { instanceId, ...event } },
    ]);
  });
});
