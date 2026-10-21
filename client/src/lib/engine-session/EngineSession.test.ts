import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITIES, type EngineCapability, type Woofx3EngineApi } from "@woofx3/api";
import { EngineDisconnectedError, EngineTimeoutError } from "@/engine/errors";
import { EngineSession, type SessionState } from "./EngineSession";
import type { EngineTarget } from "./target";
import { FakeClock } from "./testing/FakeClock";
import { FakeEngine } from "./testing/FakeEngine";
import { RecordingLogger } from "./testing/RecordingLogger";
import { waitFor } from "./testing/wait-for";

type TestApi = Pick<Woofx3EngineApi, "ping" | "getEngineCapabilities">;

const CONFIG = { reconnectBaseMs: 100, reconnectMaxMs: 400, connectTimeoutMs: 1_000, rpcTimeoutMs: 500 };

function setup(required: readonly EngineCapability[] = [ENGINE_CAPABILITIES.engineEventStream]) {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  let target: EngineTarget = engine.target();
  const targetListeners = new Set<() => void>();
  const attached: TestApi[] = [];
  let retargets = 0;
  const session = new EngineSession<TestApi>({
    targets: {
      current: async () => target,
      onChange: (listener) => {
        targetListeners.add(listener);
        return () => targetListeners.delete(listener);
      },
    },
    open: engine.open,
    required,
    hooks: {
      attach: async (api) => {
        attached.push(api);
      },
      retargeted: () => {
        retargets += 1;
      },
    },
    clock,
    random: () => 0,
    logger: new RecordingLogger(),
    config: CONFIG,
  });
  const reach = (status: SessionState["status"]) =>
    waitFor(() => session.state.status === status, `${status} (now ${JSON.stringify(session.state)})`);
  const retarget = (next: EngineTarget) => {
    target = next;
    for (const listener of targetListeners) {
      listener();
    }
  };
  return { engine, clock, session, attached, reach, retarget, retargets: () => retargets };
}

describe("EngineSession connect", () => {
  test("connects once the engine answers its capability read and the host has attached", async () => {
    const { session, attached, reach } = setup();
    session.start();
    expect(session.state).toEqual({ status: "connecting", attempt: 1 });
    await reach("connected");
    expect(attached).toHaveLength(1);
    const state = session.state;
    expect(state.status === "connected" && state.capabilities).toContain(ENGINE_CAPABILITIES.engineEventStream);
    await session.stop();
  });

  const refusals: Array<{
    name: string;
    arrange: (engine: FakeEngine) => EngineTarget;
    reason: string;
    message: RegExp;
  }> = [
    {
      name: "a target that fails validation, named by field and never by value",
      arrange: (engine) => ({ ...engine.target(), clientSecret: "short" }),
      reason: "target",
      message: /^clientSecret: /,
    },
    {
      name: "credentials the engine does not know",
      arrange: (engine) => ({ ...engine.target(), clientSecret: "cd".repeat(32) }),
      reason: "credentials",
      message: /Invalid client credentials/,
    },
    {
      name: "an engine without a required capability",
      arrange: (engine) => {
        engine.capabilities = [ENGINE_CAPABILITIES.eventsLog];
        return engine.target();
      },
      reason: "incompatible",
      message: /engine\.eventStream/,
    },
  ];

  for (const refusal of refusals) {
    test(`refuses ${refusal.name}, without retrying`, async () => {
      const { engine, clock, session, attached, reach, retarget } = setup();
      retarget(refusal.arrange(engine));
      session.start();
      await reach("refused");
      const state = session.state;
      expect(state.status === "refused" && state.reason).toBe(refusal.reason);
      expect(state.status === "refused" && state.message).toMatch(refusal.message);
      expect(state.status === "refused" && state.message).not.toContain("cdcd");
      const opened = engine.sessionsOpened;
      clock.advance(60_000);
      expect(engine.sessionsOpened).toBe(opened);
      expect(attached).toHaveLength(0);
      await session.stop();
    });
  }
});

describe("EngineSession reconnect", () => {
  test("backs off with equal jitter up to the cap, and stays there", async () => {
    const { engine, clock, session, reach } = setup();
    engine.reachable = false;
    session.start();
    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await reach("waiting");
      const state = session.state;
      if (state.status !== "waiting") {
        throw new Error("expected waiting");
      }
      delays.push(state.retryAt - clock.now());
      clock.advance(state.retryAt - clock.now());
    }
    expect(delays).toEqual([50, 100, 200, 200]);
    await session.stop();
  });

  test("a session that breaks reconnects and attaches the new one", async () => {
    const { engine, clock, session, attached, reach } = setup();
    session.start();
    await reach("connected");
    engine.breakSessions();
    await reach("waiting");
    clock.advance(CONFIG.reconnectBaseMs);
    await reach("connected");
    expect(attached).toHaveLength(2);
    expect(attached[0]).not.toBe(attached[1]);
    await session.stop();
  });

  test("reconnectNow skips the wait only while waiting", async () => {
    const { engine, session, reach } = setup();
    session.start();
    await reach("connected");
    session.reconnectNow();
    expect(session.state.status).toBe("connected");
    engine.breakSessions();
    await reach("waiting");
    session.reconnectNow();
    await reach("connected");
    expect(engine.sessionsOpened).toBe(2);
    await session.stop();
  });

  test("a changed target reconnects to it and tells the host", async () => {
    const { engine, session, reach, retarget, retargets } = setup();
    session.start();
    await reach("connected");
    engine.clientSecret = "ef".repeat(32);
    retarget(engine.target());
    expect(retargets()).toBe(1);
    await reach("connected");
    expect(engine.sessionsOpened).toBe(2);
    await session.stop();
  });

  test("stop during a connect settles the attempt and leaves nothing to reconnect", async () => {
    const { engine, clock, session } = setup();
    engine.unanswered.add("getEngineCapabilities");
    session.start();
    await waitFor(() => engine.sessions.length === 1, "the session to open");
    await session.stop();
    expect(session.state).toEqual({ status: "idle" });
    clock.advance(60_000);
    expect(engine.sessionsOpened).toBe(1);
    expect(session.state).toEqual({ status: "idle" });
  });
});

describe("EngineSession call", () => {
  test("rejects as disconnected before the session is proven", async () => {
    const { session } = setup();
    await expect(session.call("ping", (api) => api.ping())).rejects.toBeInstanceOf(EngineDisconnectedError);
  });

  test("answers through the live session", async () => {
    const { session, reach } = setup();
    session.start();
    await reach("connected");
    expect(await session.call("ping", (api) => api.ping())).toEqual({ status: "ok" });
    await session.stop();
  });

  test("rejects with a timeout when the engine never answers", async () => {
    const { engine, clock, session, reach } = setup();
    session.start();
    await reach("connected");
    engine.unanswered.add("ping");
    const pending = session.call("ping", (api) => api.ping());
    clock.advance(CONFIG.rpcTimeoutMs);
    await expect(pending).rejects.toBeInstanceOf(EngineTimeoutError);
    await session.stop();
  });

  test("rejects as disconnected when the session breaks during the call", async () => {
    const { engine, session, reach } = setup();
    session.start();
    await reach("connected");
    engine.unanswered.add("ping");
    const pending = session.call("ping", (api) => api.ping());
    engine.breakSessions();
    await expect(pending).rejects.toBeInstanceOf(EngineDisconnectedError);
    await session.stop();
  });
});
