import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Id } from "@convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Correlated, FieldOptionsReference } from "@/engine/types";

// The Convex hooks are replaced so each read's function and arguments can be
// checked: a gateway read must send what the call sites it replaced sent,
// including "skip". Rendering on the server runs each hook once without
// effects, which is all these reads need.

const queries: Array<{ name: string; args: unknown }> = [];
const dispatched: unknown[] = [];
let dispatchResult: Promise<unknown> = Promise.resolve(null);

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
}));

const { convexRequestsGateway } = await import("./requests");

function render(hook: () => unknown) {
  function Probe() {
    hook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
}

const instanceId = "instance-1" as Id<"instances">;
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
});

describe("requests.useEvent", () => {
  test("reads the latest event under the key", () => {
    render(() => convexRequestsGateway.useEvent(instanceId, "key-1"));
    expect(queries).toEqual([{ name: "transientEvents:get", args: { instanceId, correlationKey: "key-1" } }]);
  });

  test("skips without an instance or a key", () => {
    render(() => convexRequestsGateway.useEvent(null, "key-1"));
    render(() => convexRequestsGateway.useEvent(instanceId, null));
    expect(queries.map((q) => q.args)).toEqual(["skip", "skip"]);
  });

  test("still reads an empty key, which only null skips", () => {
    render(() => convexRequestsGateway.useEvent(instanceId, ""));
    expect(queries[0]?.args).toEqual({ instanceId, correlationKey: "" });
  });
});

describe("requests.useEvents", () => {
  test("reads every event under the key", () => {
    render(() => convexRequestsGateway.useEvents(instanceId, "key-1"));
    render(() => convexRequestsGateway.useEvents(null, "key-1"));
    expect(queries).toEqual([
      { name: "transientEvents:listByCorrelation", args: { instanceId, correlationKey: "key-1" } },
      { name: "transientEvents:listByCorrelation", args: "skip" },
    ]);
  });
});

describe("requests.useCorrelated", () => {
  function renderCorrelated(id: Id<"instances"> | null): Correlated<FieldOptionsReference> {
    let correlated: Correlated<FieldOptionsReference> | undefined;
    render(() => {
      correlated = convexRequestsGateway.useCorrelated("fieldOptions", id);
    });
    if (!correlated) {
      throw new Error("the probe did not render");
    }
    return correlated;
  }

  test("reads nothing before a request starts", () => {
    const correlated = renderCorrelated(instanceId);
    expect(correlated.correlationKey).toBeNull();
    expect(correlated.event).toBeUndefined();
    expect(correlated.failure).toBeNull();
    expect(queries).toEqual([{ name: "transientEvents:get", args: "skip" }]);
  });

  test("dispatches the request under a new key each time", () => {
    const correlated = renderCorrelated(instanceId);
    correlated.start(reference);
    correlated.start(reference);
    expect(dispatched).toHaveLength(2);
    const [first, second] = dispatched as Array<{ instanceId: string; reference: unknown; correlationKey: string }>;
    expect(first).toEqual({ instanceId, reference, correlationKey: expect.any(String) });
    expect(second?.correlationKey).not.toBe(first?.correlationKey);
  });

  test("swallows a failed dispatch rather than rejecting unhandled", async () => {
    dispatchResult = Promise.reject(new Error("engine unreachable"));
    const correlated = renderCorrelated(instanceId);
    correlated.start(reference);
    await Promise.resolve();
    expect(dispatched).toHaveLength(1);
  });

  test("refuses to start without an instance", () => {
    const correlated = renderCorrelated(null);
    expect(() => correlated.start(reference)).toThrow();
    expect(dispatched).toEqual([]);
  });
});
