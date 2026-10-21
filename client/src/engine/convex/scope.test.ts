import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { NoInstanceSelectedError } from "@/engine/scope";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// Gateway calls carry no instance, so these check that the adapter fills it
// in from the engine scope, and what each kind of member does while the
// scope has none: reads skip, requests reject.

const queries: Array<{ name: string; args: unknown }> = [];
const actions: Array<{ name: string; args: unknown }> = [];
const stableActions = new Map<string, (args: unknown) => Promise<null>>();

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    queries.push({ name: getFunctionName(query), args });
    return undefined;
  },
  // Convex keeps a useAction function for as long as the action's name stays
  // the same, so this does too.
  useAction: (action: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(action);
    const known = stableActions.get(name);
    if (known) {
      return known;
    }
    const run = (args: unknown) => {
      actions.push({ name, args });
      return Promise.resolve(null);
    };
    stableActions.set(name, run);
    return run;
  },
}));

const { convexAlertQueueGateway } = await import("./alert-queue");
const { convexEventLogGateway } = await import("./event-log");
const { convexScenesGateway } = await import("./scenes");
const { convexStatusGateway } = await import("./status");
const { convexWorkflowsGateway } = await import("./workflows");

const instanceId = TEST_INSTANCE_ID;

beforeEach(() => {
  queries.length = 0;
  actions.length = 0;
});

describe("requests take the instance from the scope", () => {
  test("a request sends the scope's instance with its own arguments", async () => {
    const replay = renderInScope(() => convexAlertQueueGateway.useReplayRequest());
    await replay("alert-1");
    expect(actions).toEqual([{ name: "alertActions:replay", args: { instanceId, engineAlertId: "alert-1" } }]);
  });

  test("a request rejects while the scope has no instance, and sends nothing", async () => {
    const replay = renderInScope(() => convexAlertQueueGateway.useReplayRequest(), null);
    await expect(replay("alert-1")).rejects.toBeInstanceOf(NoInstanceSelectedError);
    expect(actions).toEqual([]);
  });

  test("the connection test names its engine and needs no instance", async () => {
    const testConnection = renderInScope(() => convexStatusGateway.useConnectionTestRequest(), null);
    await testConnection("https://engine.example");
    expect(actions).toEqual([{ name: "engineHealth:testConnection", args: { url: "https://engine.example" } }]);
  });
});

describe("reads take the instance from the scope", () => {
  test("a read asks for the scope's instance", () => {
    renderInScope(() => convexWorkflowsGateway.useWorkflows());
    expect(queries).toEqual([{ name: "workflows:list", args: { instanceId } }]);
  });

  test("a read skips while the scope has no instance", () => {
    renderInScope(() => convexWorkflowsGateway.useWorkflows(), null);
    renderInScope(() => convexWorkflowsGateway.useRuns("wf-1", 5), null);
    expect(queries.map((query) => query.args)).toEqual(["skip", "skip"]);
  });

  test("a read the caller disables skips even with an instance", () => {
    renderInScope(() => convexScenesGateway.useScenes({ enabled: false }));
    renderInScope(() => convexScenesGateway.useScenes({ enabled: true }));
    expect(queries.map((query) => query.args)).toEqual(["skip", { instanceId }]);
  });
});

describe("live subscriptions need an instance", () => {
  test("subscribing throws while the scope has no instance", () => {
    const subscribe = renderInScope(() => convexEventLogGateway.useStreamEventsSubscription(), null);
    expect(() => subscribe(null, () => undefined)).toThrow(NoInstanceSelectedError);
  });

  test("an event-log read rejects while the scope has no instance", async () => {
    const listEvents = renderInScope(() => convexEventLogGateway.useEventsRequest(), null);
    await expect(listEvents()).rejects.toBeInstanceOf(NoInstanceSelectedError);
  });
});
