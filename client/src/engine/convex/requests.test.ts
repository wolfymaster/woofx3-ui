import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import type { Correlated, FieldOptionsReference, InstanceId } from "@/engine/types";
import { renderInScope, TEST_INSTANCE_ID } from "./render-in-scope";

// The Convex hooks are replaced so each read's function and arguments can be
// checked: a gateway read must send what the call sites it replaced sent,
// including "skip". Rendering on the server runs each hook once without
// effects, which is all these reads need.

const queries: Array<{ name: string; args: unknown }> = [];
const dispatched: unknown[] = [];
let dispatchResult: Promise<unknown> = Promise.resolve(null);
const watched: Array<{ name: string; args: unknown }> = [];
let watchResult: () => unknown = () => undefined;
let notifyWatch: () => void = () => undefined;
const fakeClient = {
  watchQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    watched.push({ name: getFunctionName(query), args });
    return {
      localQueryResult: () => watchResult(),
      onUpdate: (callback: () => void) => {
        notifyWatch = callback;
        return () => {
          notifyWatch = () => undefined;
        };
      },
    };
  },
};

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    queries.push({ name: getFunctionName(query), args });
    return undefined;
  },
  useAction: () => (args: unknown) => {
    dispatched.push(args);
    return dispatchResult;
  },
  useConvex: () => fakeClient,
}));

const { convexRequestsGateway } = await import("./requests");
const { NoInstanceSelectedError } = await import("./scope");

function render(hook: () => unknown, instanceId: InstanceId | null = TEST_INSTANCE_ID) {
  renderInScope(hook, instanceId);
}

const instanceId = TEST_INSTANCE_ID;
const reference: FieldOptionsReference = {
  moduleId: "obs",
  declaration: "action",
  declarationId: "switch-scene",
  fieldId: "scene",
};

beforeEach(() => {
  queries.length = 0;
  dispatched.length = 0;
  dispatchResult = Promise.resolve(null);
  watched.length = 0;
  watchResult = () => undefined;
  notifyWatch = () => undefined;
});

describe("requests.useEvent", () => {
  test("reads the latest event under the key", () => {
    render(() => convexRequestsGateway.useEvent("key-1"));
    expect(queries).toEqual([{ name: "transientEvents:get", args: { instanceId, correlationKey: "key-1" } }]);
  });

  test("skips without an instance or a key", () => {
    render(() => convexRequestsGateway.useEvent("key-1"), null);
    render(() => convexRequestsGateway.useEvent(null));
    expect(queries.map((q) => q.args)).toEqual(["skip", "skip"]);
  });

  test("still reads an empty key, which only null skips", () => {
    render(() => convexRequestsGateway.useEvent(""));
    expect(queries[0]?.args).toEqual({ instanceId, correlationKey: "" });
  });
});

describe("requests.useEvents", () => {
  test("reads every event under the key", () => {
    render(() => convexRequestsGateway.useEvents("key-1"));
    render(() => convexRequestsGateway.useEvents("key-1"), null);
    expect(queries).toEqual([
      { name: "transientEvents:listByCorrelation", args: { instanceId, correlationKey: "key-1" } },
      { name: "transientEvents:listByCorrelation", args: "skip" },
    ]);
  });
});

describe("requests.useCorrelated", () => {
  function renderCorrelated(id: InstanceId | null = TEST_INSTANCE_ID): Correlated<FieldOptionsReference> {
    let correlated: Correlated<FieldOptionsReference> | undefined;
    render(() => {
      correlated = convexRequestsGateway.useCorrelated("fieldOptions");
    }, id);
    if (!correlated) {
      throw new Error("the probe did not render");
    }
    return correlated;
  }

  test("reads nothing before a request starts", () => {
    const correlated = renderCorrelated();
    expect(correlated.correlationKey).toBeNull();
    expect(correlated.event).toBeUndefined();
    expect(correlated.failure).toBeNull();
    expect(queries).toEqual([{ name: "transientEvents:get", args: "skip" }]);
  });

  test("dispatches the request under a new key each time", () => {
    const correlated = renderCorrelated();
    correlated.start(reference);
    correlated.start(reference);
    expect(dispatched).toHaveLength(2);
    const [first, second] = dispatched as Array<{ instanceId: string; reference: unknown; correlationKey: string }>;
    expect(first).toEqual({ instanceId, reference, correlationKey: expect.any(String) });
    expect(second?.correlationKey).not.toBe(first?.correlationKey);
  });

  test("swallows a failed dispatch rather than rejecting unhandled", async () => {
    dispatchResult = Promise.reject(new Error("engine unreachable"));
    const correlated = renderCorrelated();
    correlated.start(reference);
    await Promise.resolve();
    expect(dispatched).toHaveLength(1);
  });

  test("refuses to start without an instance", () => {
    const correlated = renderCorrelated(null);
    expect(() => correlated.start(reference)).toThrow(NoInstanceSelectedError);
    expect(dispatched).toEqual([]);
  });
});

describe("requests.useSendRequest", () => {
  test("dispatches under the caller's key and resolves with the dispatch", async () => {
    dispatchResult = Promise.resolve({ correlationKey: "key-1" });
    let send: ReturnType<typeof convexRequestsGateway.useSendRequest<"fieldOptions">> | undefined;
    render(() => {
      send = convexRequestsGateway.useSendRequest("fieldOptions");
    });
    await expect(send?.(reference, "key-1")).resolves.toEqual({ correlationKey: "key-1" });
    expect(dispatched).toEqual([{ instanceId, reference, correlationKey: "key-1" }]);
  });

  test("passes a failed dispatch through to the caller", async () => {
    dispatchResult = Promise.reject(new Error("engine unreachable"));
    let send: ReturnType<typeof convexRequestsGateway.useSendRequest<"fieldOptions">> | undefined;
    render(() => {
      send = convexRequestsGateway.useSendRequest("fieldOptions");
    });
    await expect(send?.(reference, "key-1")).rejects.toThrow("engine unreachable");
  });
});

describe("requests.useEventWatchRequest", () => {
  function renderWatch() {
    let watchEvent: ReturnType<typeof convexRequestsGateway.useEventWatchRequest> | undefined;
    render(() => {
      watchEvent = convexRequestsGateway.useEventWatchRequest();
    });
    if (!watchEvent) {
      throw new Error("the probe did not render");
    }
    return watchEvent;
  }

  test("watches the latest event under the key", () => {
    renderWatch()("key-1");
    expect(watched).toEqual([{ name: "transientEvents:get", args: { instanceId, correlationKey: "key-1" } }]);
  });

  test("reads the current result and throws the read's error", () => {
    const watch = renderWatch()("key-1");
    expect(watch.current()).toBeUndefined();
    watchResult = () => {
      throw new Error("read failed");
    };
    expect(() => watch.current()).toThrow("read failed");
  });

  test("calls back on updates until unsubscribed", () => {
    const watch = renderWatch()("key-1");
    let updates = 0;
    const unsubscribe = watch.onUpdate(() => {
      updates += 1;
    });
    notifyWatch();
    unsubscribe();
    notifyWatch();
    expect(updates).toBe(1);
  });
});
