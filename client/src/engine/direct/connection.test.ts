import { describe, expect, test } from "bun:test";
import { EngineEventType, EngineRequestType, makeCallbackEnvelope, makeRequestEnvelope } from "@woofx3/api";
import type { EngineTarget } from "@/lib/engine-session/target";
import { FakeClock } from "@/lib/engine-session/testing/FakeClock";
import { FakeEngine } from "@/lib/engine-session/testing/FakeEngine";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { DEFAULT_DIRECT_GATEWAY_CONFIG } from "./config";
import { createDirectConnection, type ResyncReason } from "./connection";

// The direct connection against a fake engine over real capnweb: the held
// subscription, request answers and resyncs as the engine produces them.

function setup() {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  let target: EngineTarget = engine.target();
  const targetListeners = new Set<() => void>();
  const connection = createDirectConnection({
    targets: {
      current: async () => target,
      onChange: (listener) => {
        targetListeners.add(listener);
        return () => targetListeners.delete(listener);
      },
    },
    open: engine.open,
    clock,
    random: () => 0.5,
    logger: new RecordingLogger(),
    config: DEFAULT_DIRECT_GATEWAY_CONFIG,
  });
  const resyncs: ResyncReason[] = [];
  connection.onResync((reason) => resyncs.push(reason));
  const events: string[] = [];
  connection.onEvent((envelope) => events.push(envelope.id));
  const connected = () => waitFor(() => connection.session.state.status === "connected", "connected");
  const retarget = (next: EngineTarget) => {
    target = next;
    for (const listener of targetListeners) {
      listener();
    }
  };
  return { engine, clock, connection, resyncs, events, connected, retarget };
}

const response = (id: string) =>
  makeCallbackEnvelope(
    { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey: "c-1", status: "success", data: { n: 1 } },
    "engine",
    id
  );

describe("createDirectConnection", () => {
  test("receives events pushed after the subscribe call returned, and records their transients", async () => {
    const { engine, connection, events, resyncs, connected } = setup();
    connection.session.start();
    await connected();
    expect(resyncs).toEqual(["connected"]);
    await engine.pushEvent(response("e-1"));
    await engine.pushEvent(response("e-2"));
    expect(events).toEqual(["e-1", "e-2"]);
    expect(connection.transients.latest("c-1")).toMatchObject({ type: "engine.response", data: { n: 1 } });
    await connection.session.stop();
  });

  test("answers engine requests through answerEngineRequest", async () => {
    const { engine, connection, connected } = setup();
    connection.session.start();
    await connected();
    await engine.pushRequest(
      makeRequestEnvelope({ type: EngineRequestType.RELAY_CREDENTIAL_REQUESTED }, "engine", "r-1")
    );
    await waitFor(() => engine.answers.length === 1, "an answer");
    expect(engine.answers).toEqual([{ requestId: "r-1", answer: { ok: true, body: { relay: null } } }]);
    await connection.session.stop();
  });

  test("resyncs when frames were dropped", async () => {
    const { engine, connection, resyncs, connected } = setup();
    connection.session.start();
    await connected();
    engine.dropFrames(3);
    await engine.pushEvent(response("e-1"));
    expect(resyncs).toEqual(["connected", "gap"]);
    await connection.session.stop();
  });

  test("subscribes again on the new session after a reconnect", async () => {
    const { engine, clock, connection, events, resyncs, connected } = setup();
    connection.session.start();
    await connected();
    engine.breakSessions();
    await waitFor(() => connection.session.state.status === "waiting", "waiting");
    clock.advance(DEFAULT_DIRECT_GATEWAY_CONFIG.session.reconnectMaxMs);
    await connected();
    expect(engine.subscribeCalls).toBe(2);
    expect(resyncs).toEqual(["connected", "connected"]);
    await engine.pushEvent(response("e-3"));
    expect(events).toEqual(["e-3"]);
    await connection.session.stop();
  });

  test("a new target drops the old engine's transients", async () => {
    const { engine, connection, resyncs, connected, retarget } = setup();
    connection.session.start();
    await connected();
    await engine.pushEvent(response("e-1"));
    retarget(engine.target());
    expect(connection.transients.latest("c-1")).toBeNull();
    await connected();
    expect(resyncs).toEqual(["connected", "retargeted", "connected"]);
    await connection.session.stop();
  });

  test("refuses an engine without the event stream", async () => {
    const { engine, connection } = setup();
    engine.capabilities = engine.capabilities.filter((id) => id !== "engine.eventStream");
    connection.session.start();
    await waitFor(() => connection.session.state.status === "refused", "refused");
    expect(engine.subscribeCalls).toBe(0);
    await connection.session.stop();
  });
});
