import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each call can be checked: a gateway
// request must send what the recap hooks, the supporters page and the
// test-event hook sent before.

const calls: Array<{ name: string; args: unknown }> = [];

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => (args: unknown) => {
    calls.push({ name: getFunctionName(action), args });
    return Promise.resolve(null);
  },
}));

const { convexStreamOpsGateway } = await import("./stream-ops");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  calls.length = 0;
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
