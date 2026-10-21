import { describe, expect, test } from "bun:test";
import {
  type CallbackEnvelope,
  type EngineEventFrame,
  EngineEventType,
  EngineRequestType,
  makeCallbackEnvelope,
  makeRequestEnvelope,
  type RequestEnvelope,
} from "@woofx3/api";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { type EngineEventRoutes, EngineEventSink } from "./EngineEventSink";

function harness(routes: Partial<EngineEventRoutes> = {}) {
  const events: string[] = [];
  const requests: string[] = [];
  let missed = 0;
  let ended = 0;
  const logger = new RecordingLogger();
  const sink = new EngineEventSink(
    {
      event: (envelope: CallbackEnvelope) => events.push(envelope.id),
      request: (envelope: RequestEnvelope) => requests.push(envelope.id),
      missed: () => {
        missed += 1;
      },
      ended: () => {
        ended += 1;
      },
      ...routes,
    },
    logger,
    2
  );
  return { sink, events, requests, logger, missed: () => missed, ended: () => ended };
}

const event = (id: string, seq: number): EngineEventFrame => ({
  kind: "event",
  seq,
  envelope: makeCallbackEnvelope({ type: EngineEventType.STREAM_OFFLINE, twitchUserId: "u-1" }, "engine", id),
});

describe("EngineEventSink", () => {
  test("routes events and requests in order", async () => {
    const { sink, events, requests, missed } = harness();
    await sink.onEngineEvent(event("a", 1));
    await sink.onEngineEvent({
      kind: "request",
      seq: 2,
      envelope: makeRequestEnvelope({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "engine", "r"),
    });
    expect(events).toEqual(["a"]);
    expect(requests).toEqual(["r"]);
    expect(missed()).toBe(0);
  });

  test("reports a seq gap and still routes the frame that showed it", async () => {
    const { sink, events, missed } = harness();
    await sink.onEngineEvent(event("a", 1));
    await sink.onEngineEvent(event("b", 4));
    await sink.onEngineEvent(event("c", 5));
    expect(missed()).toBe(1);
    expect(events).toEqual(["a", "b", "c"]);
  });

  const invalid: Array<{ name: string; seq: number }> = [
    { name: "a repeated seq", seq: 2 },
    { name: "a seq that moves back", seq: 1 },
    { name: "a seq that is not an integer", seq: 2.5 },
    { name: "a seq that is not a number", seq: Number.NaN },
  ];

  for (const { name, seq } of invalid) {
    test(`logs ${name} as a gap and keeps counting from the last valid one`, async () => {
      const { sink, events, missed, logger } = harness();
      await sink.onEngineEvent(event("a", 1));
      await sink.onEngineEvent(event("b", 2));
      await sink.onEngineEvent(event("c", seq));
      await sink.onEngineEvent(event("d", 3));
      expect(missed()).toBe(1);
      expect(events).toEqual(["a", "b", "c", "d"]);
      expect(logger.entries).toMatchObject([{ level: "warn", fields: { last: 2 } }]);
    });
  }

  test("reports the end of the subscription when the engine releases it", () => {
    const { sink, ended } = harness();
    sink[Symbol.dispose]();
    expect(ended()).toBe(1);
  });

  test("drops an event id it has seen recently, and forgets the oldest past its limit", async () => {
    const { sink, events } = harness();
    for (const [index, id] of ["a", "a", "b", "c", "a"].entries()) {
      await sink.onEngineEvent(event(id, index + 1));
    }
    expect(events).toEqual(["a", "b", "c", "a"]);
  });

  test("logs a failing route instead of rejecting, so the stream goes on", async () => {
    const { sink, logger } = harness({
      event: () => {
        throw new Error("route broke");
      },
    });
    await expect(sink.onEngineEvent(event("a", 1))).resolves.toBeUndefined();
    expect(logger.entries).toMatchObject([{ level: "error", fields: { seq: 1, id: "a" } }]);
  });
});
