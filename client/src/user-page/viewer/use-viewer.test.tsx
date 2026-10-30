import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { RefreshRolesResult } from "@convex/viewerRoles";
import { getFunctionName } from "convex/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type Clock, ClockProvider } from "../clock";

// Drives useRoleCheck with a clock the test moves by hand and a fake
// viewerRoles.refresh, to check when the page asks for roles.

const refreshCalls: unknown[] = [];
let nextRefresh: () => Promise<RefreshRolesResult> = async () => ({
  ok: true,
  follower: true,
  subscriberTier: null,
  checkedAt: 0,
});

// Bun runs every test file in one process and a module mock is not undone,
// so the rest of convex/react stays real for the files loaded after this one.
const convexReact = await import("convex/react");
const stableActions = new Map<string, (args: unknown) => Promise<RefreshRolesResult>>();
mock.module("convex/react", () => ({
  ...convexReact,
  useAction: (action: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(action);
    const known = stableActions.get(name);
    if (known) {
      return known;
    }
    const run = (args: unknown) => {
      refreshCalls.push({ name, args });
      return nextRefresh();
    };
    stableActions.set(name, run);
    return run;
  },
}));

const { useRoleCheck } = await import("./use-viewer");
type ViewerEnvironment = import("./use-viewer").ViewerEnvironment;
type RoleCheck = import("./use-viewer").RoleCheck;

interface FakeClock extends Clock {
  set(now: number): void;
  /** Runs every timer due by the current time. */
  fire(): void;
  pending(): number;
}

function fakeClock(start: number): FakeClock {
  let now = start;
  let timers: { at: number; callback: () => void }[] = [];
  return {
    now: () => now,
    after: (ms, callback) => {
      const timer = { at: now + ms, callback };
      timers.push(timer);
      return () => {
        timers = timers.filter((candidate) => candidate !== timer);
      };
    },
    set: (to) => {
      now = to;
    },
    fire: () => {
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) {
        timer.callback();
      }
    },
    pending: () => timers.length,
  };
}

const ENV: ViewerEnvironment = {
  storage: {
    takeNonce: () => null,
    putNonce: () => {},
    sessionToken: () => null,
    putSessionToken: () => {},
    clearSessionToken: () => {},
  },
  origin: "https://woofx3.tv",
  pageBase: "/u/",
  pageHref: "https://woofx3.tv/u/wolfy",
  onUserPagesOrigin: true,
  pendingSignIn: null,
  navigate: () => {},
  newNonce: () => "nonce",
  random: () => 0,
};

const NOW = 1_800_000_000_000;
const TOKEN = "session";

interface ProbeProps {
  sessionToken: string | null;
  rolesStale: boolean;
  rolesRenewAt: number | null;
}

let seen: RoleCheck = "idle";
const onSignedOut = () => {};

function Probe({ sessionToken, rolesStale, rolesRenewAt }: ProbeProps) {
  seen = useRoleCheck(ENV, "wolfy", sessionToken, { rolesStale, rolesRenewAt }, onSignedOut);
  return null;
}

async function mount(clock: FakeClock, props: ProbeProps): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <ClockProvider clock={clock}>
        <Probe {...props} />
      </ClockProvider>
    );
  });
  if (!renderer) {
    throw new Error("nothing rendered");
  }
  return renderer;
}

async function update(renderer: ReactTestRenderer, clock: FakeClock, props: ProbeProps): Promise<void> {
  await act(async () => {
    renderer.update(
      <ClockProvider clock={clock}>
        <Probe {...props} />
      </ClockProvider>
    );
  });
}

async function advance(clock: FakeClock, to: number): Promise<void> {
  await act(async () => {
    clock.set(to);
    clock.fire();
  });
}

beforeEach(() => {
  refreshCalls.length = 0;
  seen = "idle";
  nextRefresh = async () => ({ ok: true, follower: true, subscriberTier: null, checkedAt: 0 });
});

describe("useRoleCheck renewal", () => {
  test("renews current roles at their renewal time, not before", async () => {
    const clock = fakeClock(NOW);
    const renewAt = NOW + 8 * 60_000;
    await mount(clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: renewAt });
    expect(refreshCalls).toEqual([]);
    await advance(clock, renewAt - 1);
    expect(refreshCalls).toEqual([]);
    await advance(clock, renewAt);
    expect(refreshCalls).toEqual([{ name: "viewerRoles:refresh", args: { sessionToken: TOKEN, slug: "wolfy" } }]);
  });

  test("renews at once when the renewal time has already passed", async () => {
    const clock = fakeClock(NOW);
    const renderer = await mount(clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: NOW - 5 });
    await advance(clock, NOW);
    expect(refreshCalls).toHaveLength(1);
    renderer.unmount();
  });

  test("stops once the read moves the renewal time on, and schedules the next one", async () => {
    const clock = fakeClock(NOW);
    const renewAt = NOW + 1000;
    const renderer = await mount(clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: renewAt });
    await advance(clock, renewAt);
    expect(refreshCalls).toHaveLength(1);
    const nextRenewAt = renewAt + 8 * 60_000;
    await update(renderer, clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: nextRenewAt });
    expect(seen).toBe("idle");
    await advance(clock, nextRenewAt - 1);
    expect(refreshCalls).toHaveLength(1);
    await advance(clock, nextRenewAt);
    expect(refreshCalls).toHaveLength(2);
  });

  test("retries a renewal Twitch could not answer, with backoff", async () => {
    nextRefresh = async () => ({ ok: false, error: "unavailable" });
    const clock = fakeClock(NOW);
    await mount(clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: NOW });
    await advance(clock, NOW);
    expect(refreshCalls).toHaveLength(1);
    expect(seen).toBe("retrying");
    await advance(clock, NOW + 29_999);
    expect(refreshCalls).toHaveLength(1);
    await advance(clock, NOW + 30_000);
    expect(refreshCalls).toHaveLength(2);
  });

  test("schedules nothing without a session or without a renewal time", async () => {
    const clock = fakeClock(NOW);
    await mount(clock, { sessionToken: null, rolesStale: false, rolesRenewAt: NOW + 1000 });
    await mount(clock, { sessionToken: TOKEN, rolesStale: false, rolesRenewAt: null });
    expect(clock.pending()).toBe(0);
    await advance(clock, NOW + 60 * 60_000);
    expect(refreshCalls).toEqual([]);
  });

  test("a stale read asks straight away", async () => {
    const clock = fakeClock(NOW);
    await mount(clock, { sessionToken: TOKEN, rolesStale: true, rolesRenewAt: null });
    expect(refreshCalls).toHaveLength(1);
    expect(seen).toBe("checking");
  });
});
