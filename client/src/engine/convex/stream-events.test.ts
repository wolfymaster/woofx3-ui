import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { StreamEventFrame } from "@/engine/types";
import { renderInScope } from "./render-in-scope";

// The Convex client is replaced by a watch whose answer the test sets, so the
// subscription's reading of it can be checked: the first answer is the
// baseline, later rows are new, and a frame goes only to a subscriber that
// asked for its type.

type Row = { id: string; frame: StreamEventFrame };

let rows: Row[] | undefined;
let notify: () => void = () => undefined;
let unsubscribed = 0;

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");

mock.module("convex/react", () => ({
  ...convexReact,
  useConvex: () => ({
    watchQuery: () => ({
      localQueryResult: () => rows,
      onUpdate: (callback: () => void) => {
        notify = callback;
        return () => {
          unsubscribed += 1;
        };
      },
    }),
  }),
}));

const { convexEventLogGateway } = await import("./event-log");

function frame(id: string, type: string): StreamEventFrame {
  return { id, type, source: "twitch", time: "2026-11-24T00:00:00Z", data: {} };
}

function subscribe(types: string[]) {
  const received: StreamEventFrame[] = [];
  const subscription = renderInScope(() => convexEventLogGateway.useStreamEventsSubscription());
  const stop = subscription(types, (pushed) => received.push(pushed));
  return { received, stop };
}

beforeEach(() => {
  rows = undefined;
  notify = () => undefined;
  unsubscribed = 0;
});

describe("stream events through Convex", () => {
  test("rows already there when subscribing are not replayed", () => {
    rows = [{ id: "r1", frame: frame("e1", "channel.follow") }];
    const { received } = subscribe(["channel.follow"]);
    notify();
    expect(received).toEqual([]);
  });

  test("a row that arrives later is pushed once, oldest first", () => {
    rows = [{ id: "r1", frame: frame("e1", "channel.follow") }];
    const { received } = subscribe(["channel.follow"]);
    rows = [
      { id: "r3", frame: frame("e3", "channel.follow") },
      { id: "r2", frame: frame("e2", "channel.follow") },
      { id: "r1", frame: frame("e1", "channel.follow") },
    ];
    notify();
    notify();
    expect(received.map((pushed) => pushed.id)).toEqual(["e2", "e3"]);
  });

  test("the first answer, when it comes after subscribing, is the baseline", () => {
    const { received } = subscribe(["channel.follow"]);
    rows = [{ id: "r1", frame: frame("e1", "channel.follow") }];
    notify();
    expect(received).toEqual([]);
  });

  test("a type the subscriber did not ask for is not pushed", () => {
    rows = [];
    const { received } = subscribe(["channel.cheer"]);
    rows = [{ id: "r1", frame: frame("e1", "channel.follow") }];
    notify();
    expect(received).toEqual([]);
  });

  test("unsubscribing ends the watch", () => {
    rows = [];
    subscribe(["channel.follow"]).stop();
    expect(unsubscribed).toBe(1);
  });
});
