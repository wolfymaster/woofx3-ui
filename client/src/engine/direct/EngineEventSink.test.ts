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
  const gaps: Array<[number, number]> = [];
  const logger = new RecordingLogger();
  const sink = new EngineEventSink(
    {
      event: (envelope: CallbackEnvelope) => events.push(envelope.id),
      request: (envelope: RequestEnvelope) => requests.push(envelope.id),
      gap: (expected, received) => gaps.push([expected, received]),
      ...routes,
    },
    logger,
    2
  );
  return { sink, events, requests, gaps, logger };
}

const event = (id: string, seq: number): EngineEventFrame => ({
  kind: "event",
  seq,
  envelope: makeCallbackEnvelope({ type: EngineEventType.STREAM_OFFLINE, twitchUserId: "u-1" }, "engine", id),
});

describe("EngineEventSink", () => {
  test("routes events and requests in order", async () => {
    const { sink, events, requests, gaps } = harness();
    await sink.onEngineEvent(event("a", 1));
    await sink.onEngineEvent({
      kind: "request",
      seq: 2,
      envelope: makeRequestEnvelope({ type: EngineRequestType.TWITCH_TOKEN_REQUESTED }, "engine", "r"),
    });
    expect(events).toEqual(["a"]);
    expect(requests).toEqual(["r"]);
    expect(gaps).toEqual([]);
  });

  test("reports a seq gap and still routes the frame that showed it", async () => {
    const { sink, events, gaps } = harness();
    await sink.onEngineEvent(event("a", 1));
    await sink.onEngineEvent(event("b", 4));
    expect(gaps).toEqual([[2, 4]]);
    expect(events).toEqual(["a", "b"]);
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
