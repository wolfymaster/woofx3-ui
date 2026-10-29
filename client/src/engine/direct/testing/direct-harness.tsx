import { Component, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { EngineScopeProvider } from "@/engine/scope";
import type { EngineScope, InstanceId } from "@/engine/types";
import { FakeClock } from "@/lib/engine-session/testing/FakeClock";
import { FakeEngine } from "@/lib/engine-session/testing/FakeEngine";
import { RecordingLogger } from "@/lib/engine-session/testing/RecordingLogger";
import { waitFor } from "@/lib/engine-session/testing/wait-for";
import { DEFAULT_DIRECT_GATEWAY_CONFIG, type DirectGatewayConfig } from "../config";
import { createDirectRuntime, type DirectRuntime } from "../runtime";
import { DirectFakeApi, FakeEngineState } from "./DirectFakeApi";

// The direct gateway's tests run its hooks for real: a runtime connected to
// a fake engine over capnweb on a MessageChannel, and hooks rendered with
// effects, so TanStack Query fetches, the event stream invalidates, and the
// screen's value changes as it would in the app.

export const TEST_INSTANCE_ID = "instance-1" as InstanceId;

// Engine answers land on the event loop, between a test's awaits, so the
// renders they cause cannot be wrapped in act; React is told this is not an
// act environment rather than warning about each of them.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/** One read failure a test expects, with no retry waiting on real timers. */
const TEST_CONFIG: DirectGatewayConfig = { ...DEFAULT_DIRECT_GATEWAY_CONFIG, queryAttempts: 1 };

export interface DirectHarness {
  engine: FakeEngine;
  state: FakeEngineState;
  clock: FakeClock;
  logger: RecordingLogger;
  runtime: DirectRuntime;
  /** Pings that `runtime.ping` was asked for, by URL. */
  pings: string[];
  /** Starts the runtime and resolves once its session is connected. */
  connect(): Promise<void>;
}

/** `overrides` replace parts of the test config, e.g. a page size small enough to page through. */
export function createDirectHarness(overrides: Partial<DirectGatewayConfig> = {}): DirectHarness {
  const state = new FakeEngineState();
  const engine = new FakeEngine((fake) => new DirectFakeApi(fake, state));
  const clock = new FakeClock();
  const logger = new RecordingLogger();
  const pings: string[] = [];
  const runtime = createDirectRuntime({
    targets: { current: async () => engine.target(), onChange: () => () => {} },
    open: engine.open,
    clock,
    random: () => 0.5,
    logger,
    config: { ...TEST_CONFIG, ...overrides },
    ping: async (url) => {
      pings.push(url);
    },
  });
  return {
    engine,
    state,
    clock,
    logger,
    runtime,
    pings,
    connect: async () => {
      runtime.start();
      await waitFor(() => runtime.connection.session.state.status === "connected", "the session to connect");
    },
  };
}

class Catch extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface RenderedHook<T> {
  /** The hook's value at its latest render. */
  current(): T;
  /** What the hook threw to its error boundary, if it threw. */
  error(): unknown;
  /** Resolves once `condition` holds of the latest value. */
  until(condition: (value: T) => boolean, what: string): Promise<T>;
  unmount(): void;
}

/** Renders `hook` under a scope holding `instanceId` (null: none selected), with effects. */
export function renderDirect<T>(hook: () => T, instanceId: InstanceId | null = TEST_INSTANCE_ID): RenderedHook<T> {
  const scope: EngineScope = { instanceId, optimisticInstanceId: instanceId, isInstanceLoading: false };
  let latest: { value: T } | undefined;
  let thrown: unknown;
  function Probe() {
    latest = { value: hook() };
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <EngineScopeProvider scope={scope}>
        <Catch
          onError={(error) => {
            thrown = error;
          }}
        >
          <Probe />
        </Catch>
      </EngineScopeProvider>
    );
  });
  const current = (): T => {
    if (latest === undefined) {
      throw new Error("the hook has not rendered");
    }
    return latest.value;
  };
  return {
    current,
    error: () => thrown,
    until: async (condition, what) => {
      await waitFor(() => latest !== undefined && condition(latest.value), what);
      return current();
    },
    unmount: () => {
      act(() => renderer?.unmount());
    },
  };
}
