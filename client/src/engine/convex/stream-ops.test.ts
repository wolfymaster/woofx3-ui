import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The Convex hooks are replaced so each call can be checked: a gateway
// request must send what the recap hooks it replaced sent.

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

function renderRequest<T>(hook: () => T): T {
  let value: T | undefined;
  function Probe() {
    value = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (value === undefined) {
    throw new Error("the probe did not render");
  }
  return value;
}

const instanceId = "instance-1" as Id<"instances">;

beforeEach(() => {
  calls.length = 0;
});

describe("streamOps recap requests", () => {
  test("load a session's engine detail and timeline events", async () => {
    const loadDetail = renderRequest(() => convexStreamOpsGateway.useRecapEngineDetailRequest());
    const loadEvents = renderRequest(() => convexStreamOpsGateway.useRecapTimelineEventsRequest());
    await loadDetail(instanceId, "session-1");
    await loadEvents(instanceId, "session-1");
    expect(calls).toEqual([
      { name: "streamRecap:loadEngineDetail", args: { instanceId, sessionId: "session-1" } },
      { name: "streamRecap:loadTimelineEvents", args: { instanceId, sessionId: "session-1" } },
    ]);
  });

  test("refresh the open session", async () => {
    const refresh = renderRequest(() => convexStreamOpsGateway.useOpenSessionRefreshRequest());
    await refresh(instanceId);
    expect(calls).toEqual([{ name: "streamRecap:refreshOpenSession", args: { instanceId } }]);
  });
});
