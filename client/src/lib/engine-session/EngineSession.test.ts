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

interface AttachStep {
  attempt: number;
  engine: FakeEngine;
  clock: FakeClock;
}

interface SetupOptions {
  required?: readonly EngineCapability[];
  /** Runs after the default attach step records the session; `attempt` counts from 1. */
  attach?: (step: AttachStep) => Promise<void>;
  /** Replaces the target source's `current`, to hold or fail the read. */
  current?: (target: EngineTarget) => Promise<EngineTarget>;
  retargeted?: () => void;
}

function setup(options: SetupOptions = {}) {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  const logger = new RecordingLogger();
  let target: EngineTarget = engine.target();
  const targetListeners = new Set<() => void>();
  const attached: TestApi[] = [];
  const losers: Array<(reason: unknown) => void> = [];
  let retargets = 0;
  const session = new EngineSession<TestApi>({
    targets: {
      current: async () => (options.current ? options.current(target) : target),
      onChange: (listener) => {
        targetListeners.add(listener);
        return () => targetListeners.delete(listener);
      },
    },
    open: engine.open,
    required: options.required ?? [ENGINE_CAPABILITIES.engineEventStream],
    hooks: {
      attach: async (api, lost) => {
        attached.push(api);
        losers.push(lost);
        await options.attach?.({ attempt: attached.length, engine, clock });
      },
      retargeted: () => {
        retargets += 1;
        options.retargeted?.();
      },
    },
    clock,
    random: () => 0,
    logger,
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
  return { engine, clock, session, logger, attached, losers, reach, retarget, retargets: () => retargets };
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

describe("EngineSession failure paths", () => {
  const never = () => new Promise<void>(() => {});

  test("a capability read that never answers times out into waiting", async () => {
    const { engine, clock, session, reach } = setup();
    engine.unanswered.add("getEngineCapabilities");
    session.start();
    await waitFor(() => engine.sessions.length === 1, "the session to open");
    clock.advance(CONFIG.connectTimeoutMs - 1);
    expect(session.state.status).toBe("connecting");
    clock.advance(1);
    await reach("waiting");
    const state = session.state;
    expect(state.status === "waiting" && state.lastError).toContain("getEngineCapabilities");
    await session.stop();
  });

  test("the capability read and the attach step share one connect budget", async () => {
    const { clock, session, attached, reach } = setup({
      attach: (step) => {
        step.clock.advance(600);
        return never();
      },
    });
    session.start();
    await waitFor(() => attached.length === 1, "the attach step");
    clock.advance(CONFIG.connectTimeoutMs - 600);
    await reach("waiting");
    const state = session.state;
    expect(state.status === "waiting" && state.lastError).toContain("attach");
    await session.stop();
  });

  test("an attach step that rejects is retried and never reports connected", async () => {
    const { clock, session, attached, reach } = setup({
      attach: async ({ attempt }) => {
        if (attempt === 1) {
          throw new Error("subscribe failed");
        }
      },
    });
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.state.status));
    session.start();
    await reach("waiting");
    expect(seen).not.toContain("connected");
    clock.advance(CONFIG.reconnectBaseMs);
    await reach("connected");
    expect(attached).toHaveLength(2);
    await session.stop();
  });

  test("a target change while the target is still being read leaves the old read unused", async () => {
    let release: (() => void) | null = null;
    let reads = 0;
    const { engine, session, reach, retarget } = setup({
      current: async (target) => {
        reads += 1;
        if (reads === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return target;
      },
    });
    session.start();
    await waitFor(() => release !== null, "the first read");
    retarget(engine.target());
    await reach("connected");
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(engine.sessionsOpened).toBe(1);
    expect(session.state.status).toBe("connected");
    await session.stop();
  });

  test("a session that breaks during the attach step is retried", async () => {
    const { clock, session, attached, reach } = setup({
      attach: ({ attempt, engine }) => {
        if (attempt === 1) {
          engine.breakSessions();
          return never();
        }
        return Promise.resolve();
      },
    });
    session.start();
    await reach("waiting");
    clock.advance(CONFIG.reconnectBaseMs);
    await reach("connected");
    expect(attached).toHaveLength(2);
    await session.stop();
  });

  test("a session the host reports lost reconnects, and a stale report does nothing", async () => {
    const { clock, session, attached, losers, reach } = setup();
    session.start();
    await reach("connected");
    losers[0](new Error("the engine ended the event subscription"));
    expect(session.state.status).toBe("waiting");
    clock.advance(CONFIG.reconnectBaseMs);
    await reach("connected");
    expect(attached).toHaveLength(2);
    losers[0](new Error("late"));
    expect(session.state.status).toBe("connected");
    await session.stop();
  });

  test("a state listener that throws is logged and the session stays connected", async () => {
    const { engine, session, logger, reach } = setup();
    session.subscribe(() => {
      if (session.state.status === "connected") {
        throw new Error("listener broke");
      }
    });
    session.start();
    await reach("connected");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(session.state.status).toBe("connected");
    expect(engine.sessionsOpened).toBe(1);
    expect(logger.entries.some((entry) => entry.level === "error")).toBe(true);
  });

  test("a retargeted hook that throws still reconnects to the new target", async () => {
    const { engine, session, reach, retarget } = setup({
      retargeted: () => {
        throw new Error("hook broke");
      },
    });
    session.start();
    await reach("connected");
    retarget(engine.target());
    await reach("connected");
    expect(engine.sessionsOpened).toBe(2);
    await session.stop();
  });

  test("reconnectNow and a target change check an incompatible engine again", async () => {
    const { engine, session, reach, retarget } = setup();
    const full = engine.capabilities;
    engine.capabilities = [ENGINE_CAPABILITIES.eventsLog];
    session.start();
    await reach("refused");
    engine.capabilities = full;
    session.reconnectNow();
    await reach("connected");
    engine.capabilities = [ENGINE_CAPABILITIES.eventsLog];
    retarget(engine.target());
    await reach("refused");
    engine.capabilities = full;
    retarget(engine.target());
    await reach("connected");
    await session.stop();
  });

  test("reconnectNow does not retry refused credentials", async () => {
    const { engine, session, reach, retarget } = setup();
    retarget({ ...engine.target(), clientSecret: "cd".repeat(32) });
    session.start();
    await reach("refused");
    session.reconnectNow();
    expect(session.state.status).toBe("refused");
    expect(engine.sessionsOpened).toBe(1);
    await session.stop();
  });
});
