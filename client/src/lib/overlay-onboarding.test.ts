import { describe, expect, test } from "bun:test";
import type { DefaultSeedStatus, EngineAlert, SceneRecord } from "@/engine/types";
import {
  followAlertOf,
  INITIAL_OVERLAY_STATE,
  type OverlayEvent,
  type OverlayFacts,
  type OverlayState,
  overlayReducer,
  overlaySceneOf,
  SEED_MIRROR_GRACE_MS,
  SEED_SLOW_AFTER_MS,
  seedHasRecordedError,
  seedIsSlow,
  TEST_UNCONFIRMED_AFTER_MS,
  testOutcomeOf,
  waitingHelp,
} from "./overlay-onboarding";

const READY: OverlayFacts = {
  engine: "ready",
  scene: "found",
  follow: "ready",
  seedError: false,
  presence: "closed",
  test: { kind: "none" },
};

function run(state: OverlayState, ...events: OverlayEvent[]): OverlayState {
  return events.reduce(overlayReducer, state);
}

const observe = (facts: Partial<OverlayFacts>, at = 0): OverlayEvent => ({
  type: "observe",
  facts: { ...READY, ...facts },
  at,
});

const waiting = run(INITIAL_OVERLAY_STATE, observe({}));
const connected = run(waiting, observe({ presence: "open" }));
const playing = run(connected, { type: "send" }, { type: "sent", triggerId: "t1", at: 1000 });

describe("overlayReducer: getting to the link", () => {
  test("waits on the build, then says so when it fails", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ engine: "building" })).phase.name).toBe("building");
    expect(run(INITIAL_OVERLAY_STATE, observe({ engine: "failed" })).phase.name).toBe("build-failed");
  });

  test("a built engine with the seed still running prepares", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ scene: "pending" })).phase.name).toBe("preparing");
    expect(run(INITIAL_OVERLAY_STATE, observe({ scene: "loading" })).phase.name).toBe("preparing");
  });

  test("a failed seed asks for a retry, and a retry that lands moves on", () => {
    const failed = run(INITIAL_OVERLAY_STATE, observe({ scene: "failed" }));
    expect(failed.phase.name).toBe("seed-failed");
    expect(run(failed, observe({ scene: "found" })).phase.name).toBe("waiting");
  });

  test("a scene absent from the reads is deleted only after the grace", () => {
    const first = run(INITIAL_OVERLAY_STATE, observe({ scene: "absent" }, 100));
    expect(first.phase.name).toBe("preparing");
    expect(run(first, observe({ scene: "absent" }, 100 + SEED_MIRROR_GRACE_MS - 1)).phase.name).toBe("preparing");
    const gone = run(first, observe({ scene: "absent" }, 100 + SEED_MIRROR_GRACE_MS));
    expect(gone.phase.name).toBe("no-scene");
    expect(run(gone, observe({ scene: "found" }, 100 + SEED_MIRROR_GRACE_MS + 1)).phase.name).toBe("waiting");
  });

  test("a setup that was never seeded has no scene at once", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ scene: "none" })).phase.name).toBe("no-scene");
  });

  test("an unknown presence waits rather than claiming a connection", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ presence: "unknown" })).phase.name).toBe("waiting");
  });

  test("holds off choosing before the first presence answer, so a refresh does not flash waiting", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ presence: undefined })).phase.name).toBe("preparing");
    expect(run(connected, observe({ presence: undefined })).phase.name).toBe("connected");
  });
});

describe("overlayReducer: presence", () => {
  test("an open overlay connects", () => {
    expect(connected.phase.name).toBe("connected");
  });

  test("waiting keeps its start across polls, so the help timers run", () => {
    const later = run(waiting, observe({}, 5000));
    expect(later.phase).toEqual({ name: "waiting", since: 0, dropped: false });
  });

  test("a drop goes back to waiting, flagged, and the clock starts again", () => {
    expect(run(connected, observe({ presence: "closed" }, 9000)).phase).toEqual({
      name: "waiting",
      since: 9000,
      dropped: true,
    });
  });

  test("an unknown answer neither connects nor disconnects", () => {
    expect(run(connected, observe({ presence: "unknown" })).phase.name).toBe("connected");
    expect(run(waiting, observe({ presence: "unknown" })).phase.name).toBe("waiting");
    expect(run(playing, observe({ presence: "unknown" }, 1001)).phase.name).toBe("playing");
  });

  test("a drop mid-test abandons the test", () => {
    const dropped = run(playing, observe({ presence: "closed" }, 2000));
    expect(dropped.phase.name).toBe("waiting");
    expect(dropped.triggerIds).toEqual([]);
  });

  test("a send landing after a drop does not resurrect the test", () => {
    const sending = run(connected, { type: "send" });
    const dropped = run(sending, observe({ presence: "closed" }, 500));
    expect(run(dropped, { type: "sent", triggerId: "late", at: 600 })).toBe(dropped);
  });

  test("the seed disappearing mid-test blocks the page", () => {
    const blocked = run(playing, observe({ presence: "open", scene: "failed" }, 1200));
    expect(blocked.phase.name).toBe("seed-failed");
    expect(blocked.triggerIds).toEqual([]);
  });
});

describe("overlayReducer: the test", () => {
  const open = { presence: "open" } as const;

  test("only sends from where the button is", () => {
    expect(run(waiting, { type: "send" })).toBe(waiting);
    expect(run(connected, { type: "send" }).phase.name).toBe("sending");
  });

  test("completed finishes", () => {
    expect(run(playing, observe({ ...open, test: { kind: "completed" } }, 1500)).phase.name).toBe("finished");
  });

  test("finished survives the overlay closing, as a plain tab will", () => {
    const finished = run(playing, observe({ ...open, test: { kind: "completed" } }, 1500));
    expect(run(finished, observe({ presence: "closed", test: { kind: "none" } }, 1600)).phase.name).toBe("finished");
  });

  test("a completion and a drop in one poll is a completion", () => {
    expect(run(playing, observe({ presence: "closed", test: { kind: "completed" } }, 1500)).phase.name).toBe(
      "finished"
    );
  });

  test("failed carries the reason", () => {
    const failed = run(playing, observe({ ...open, test: { kind: "failed", reason: "nope" } }, 1500));
    expect(failed.phase).toEqual({ name: "test-failed", reason: "nope" });
  });

  test("a refused send fails with no reason, and can be tried again", () => {
    const refused = run(connected, { type: "send" }, { type: "send-refused" });
    expect(refused.phase).toEqual({ name: "test-failed", reason: null });
    expect(run(refused, { type: "send" }).phase.name).toBe("sending");
  });

  test("goes unconfirmed at the limit and not before", () => {
    expect(run(playing, observe(open, 1000 + TEST_UNCONFIRMED_AFTER_MS - 1)).phase.name).toBe("playing");
    expect(run(playing, observe(open, 1000 + TEST_UNCONFIRMED_AFTER_MS)).phase.name).toBe("unconfirmed");
  });

  test("unconfirmed can be confirmed, resent, or answered late", () => {
    const unconfirmed = run(playing, observe(open, 1000 + TEST_UNCONFIRMED_AFTER_MS));
    expect(run(unconfirmed, { type: "confirmed-seen" }).phase.name).toBe("finished");
    expect(run(unconfirmed, { type: "send" }).phase.name).toBe("sending");
    expect(run(unconfirmed, observe({ ...open, test: { kind: "completed" } })).phase.name).toBe("finished");
    expect(run(unconfirmed, observe({ ...open, test: { kind: "failed", reason: null } })).phase.name).toBe(
      "test-failed"
    );
  });

  test("confirming means nothing outside unconfirmed", () => {
    expect(run(playing, { type: "confirmed-seen" })).toBe(playing);
  });

  test("sending again keeps the earlier test, whose late answer still counts", () => {
    const again = run(
      playing,
      observe(open, 1000 + TEST_UNCONFIRMED_AFTER_MS),
      { type: "send" },
      { type: "sent", triggerId: "t2", at: 70_000 }
    );
    expect(again.triggerIds).toEqual(["t1", "t2"]);
  });
});

describe("overlayReducer: the follow alert", () => {
  test("absent is missing only after the grace; never seeded at once", () => {
    const first = run(connected, observe({ presence: "open", follow: "absent" }, 100));
    expect(first.follow).toBe("pending");
    expect(run(first, observe({ presence: "open", follow: "absent" }, 100 + SEED_MIRROR_GRACE_MS)).follow).toBe(
      "missing"
    );
    expect(run(connected, observe({ presence: "open", follow: "none" })).follow).toBe("missing");
  });

  test("does not block the link", () => {
    expect(run(INITIAL_OVERLAY_STATE, observe({ follow: "failed" })).phase.name).toBe("waiting");
  });
});

describe("waitingHelp", () => {
  test.each([
    [59_999, "none"],
    [60_000, "hint"],
    [179_999, "hint"],
    [180_000, "troubleshoot"],
  ] as const)("after %d ms: %s", (waited, expected) => {
    expect(waitingHelp(1000, 1000 + waited)).toBe(expected);
  });
});

function alertFor(triggerId: string, status: EngineAlert["status"], error?: string): EngineAlert {
  return { status, error, payload: JSON.stringify({ event: { triggerId } }) } as EngineAlert;
}

describe("testOutcomeOf", () => {
  test("nothing yet", () => {
    expect(testOutcomeOf([], ["t1"])).toEqual({ kind: "none" });
    expect(testOutcomeOf([alertFor("t1", "playing")], ["t1"])).toEqual({ kind: "none" });
    expect(testOutcomeOf([alertFor("other", "completed")], ["t1"])).toEqual({ kind: "none" });
    expect(testOutcomeOf([alertFor("t1", "completed")], [])).toEqual({ kind: "none" });
  });

  test("any completion counts, even an earlier test's", () => {
    expect(testOutcomeOf([alertFor("t1", "completed")], ["t1", "t2"])).toEqual({ kind: "completed" });
  });

  test("only the latest failing fails", () => {
    expect(testOutcomeOf([alertFor("t1", "failed", "x")], ["t1", "t2"])).toEqual({ kind: "none" });
    expect(testOutcomeOf([alertFor("t2", "failed", "x")], ["t1", "t2"])).toEqual({ kind: "failed", reason: "x" });
    expect(testOutcomeOf([alertFor("t1", "timed_out")], ["t1"])).toEqual({ kind: "failed", reason: null });
  });
});

const seedWith = (overrides: Partial<DefaultSeedStatus>): DefaultSeedStatus => ({
  scene: { status: "installed", engineSceneId: "s1" },
  alerts: [{ itemId: "follow", event: "channel.follow", status: "installed", engineWorkflowId: "w1" }],
  alertImagesOmitted: false,
  neverSeeded: false,
  overlayDone: null,
  ...overrides,
});
const scene = (engineSceneId: string, widgets: unknown[] = []): SceneRecord =>
  ({ id: engineSceneId, engineSceneId, widgets }) as unknown as SceneRecord;
const CATALOG = [{ widgetId: "alert-w", hostsSurface: "alert" }];
const defaultAlertWidget = { widgetCanonicalId: "alert-w", settings: { name: "default" } };

describe("overlaySceneOf", () => {
  test("loading until everything has answered", () => {
    expect(overlaySceneOf(undefined, [], CATALOG).fact).toBe("loading");
    expect(overlaySceneOf(seedWith({}), undefined, CATALOG).fact).toBe("loading");
    expect(overlaySceneOf(seedWith({}), [], undefined).fact).toBe("loading");
  });

  test("the seeded scene, not the oldest one", () => {
    const result = overlaySceneOf(seedWith({}), [scene("imported"), scene("s1")], CATALOG);
    expect(result.fact).toBe("found");
    expect(result.scene?.engineSceneId).toBe("s1");
  });

  test("a deleted scene with installed status reads as absent", () => {
    expect(overlaySceneOf(seedWith({}), [scene("imported")], CATALOG).fact).toBe("absent");
  });

  test("a scene with the default alert widget stands in", () => {
    const result = overlaySceneOf(seedWith({}), [scene("imported"), scene("mine", [defaultAlertWidget])], CATALOG);
    expect(result.scene?.engineSceneId).toBe("mine");
  });

  test("the seed's own state otherwise", () => {
    expect(overlaySceneOf(seedWith({ scene: { status: "pending" } }), [], CATALOG).fact).toBe("pending");
    expect(overlaySceneOf(seedWith({ scene: { status: "failed" } }), [], CATALOG).fact).toBe("failed");
    expect(overlaySceneOf(seedWith({ scene: { status: "pending" }, neverSeeded: true }), [], CATALOG).fact).toBe(
      "none"
    );
  });
});

describe("followAlertOf", () => {
  const workflows = [{ engineWorkflowId: "w1" }];

  test("ready needs the workflow in the reads", () => {
    expect(followAlertOf(seedWith({}), workflows).fact).toBe("ready");
    expect(followAlertOf(seedWith({}), []).fact).toBe("absent");
    expect(followAlertOf(seedWith({}), undefined).fact).toBe("pending");
  });

  test("the seed's own state otherwise", () => {
    const alert = { itemId: "follow", event: "channel.follow" };
    expect(followAlertOf(seedWith({ alerts: [{ ...alert, status: "failed" }] }), workflows).fact).toBe("failed");
    expect(followAlertOf(seedWith({ alerts: [{ ...alert, status: "pending" }] }), workflows).fact).toBe("pending");
    expect(
      followAlertOf(seedWith({ alerts: [{ ...alert, status: "pending" }], neverSeeded: true }), workflows).fact
    ).toBe("none");
    expect(followAlertOf(undefined, workflows).fact).toBe("pending");
  });

  test("installed without an id yet is pending, not ready", () => {
    expect(
      followAlertOf(seedWith({ alerts: [{ itemId: "follow", event: "e", status: "installed" }] }), workflows).fact
    ).toBe("pending");
  });
});

describe("a seed attempt that failed", () => {
  const erring = observe({ scene: "pending", seedError: true }, 1000);
  const started = run(INITIAL_OVERLAY_STATE, erring);

  test("reads as ordinary progress for the first minute, then as slow", () => {
    expect(started.phase.name).toBe("preparing");
    expect(seedIsSlow(started, 1000 + SEED_SLOW_AFTER_MS - 1)).toBe(false);
    expect(seedIsSlow(started, 1000 + SEED_SLOW_AFTER_MS)).toBe(true);
  });

  test("keeps its clock across attempts that fail the same way", () => {
    const later = run(started, observe({ scene: "pending", seedError: true }, 40_000));
    expect(later.seedErrorSince).toBe(1000);
  });

  test("Try again starts the clock over", () => {
    const retried = run(started, { type: "seed-retried" });
    const next = run(retried, observe({ scene: "pending", seedError: true }, 90_000));
    expect(seedIsSlow(next, 90_000)).toBe(false);
    expect(next.seedErrorSince).toBe(90_000);
  });

  test("clears once the error does", () => {
    expect(run(started, observe({ scene: "pending" }, 2000)).seedErrorSince).toBeNull();
  });
});

describe("seedHasRecordedError", () => {
  test.each([
    ["nothing wrong", seedWith({}), false],
    ["no status yet", null, false],
    ["pending with no error", seedWith({ scene: { status: "pending" } }), false],
    ["a pending scene with an error", seedWith({ scene: { status: "pending", error: "x" } }), true],
    [
      "a pending alert with an error",
      seedWith({ alerts: [{ itemId: "sub", event: "e", status: "pending", error: "x" }] }),
      true,
    ],
    ["settled as failed", seedWith({ scene: { status: "failed", error: "x" } }), false],
  ])("%s", (_name, seed, expected) => {
    expect(seedHasRecordedError(seed)).toBe(expected);
  });
});

describe("a test sent to an overlay the engine has not noticed closing", () => {
  const stillOpen = { presence: "open" } as const;
  const sent = run(run(connected, { type: "send" }), { type: "sent", triggerId: "t1", at: 1000 });
  const failure = { kind: "failed", reason: "no overlay" } as const;

  test("fails with the engine's reason, not Did you see it?", () => {
    expect(run(sent, observe({ ...stillOpen, test: failure }, 5000)).phase).toEqual({
      name: "test-failed",
      reason: "no overlay",
    });
  });

  test("a failure after the unconfirmed limit still wins", () => {
    const unconfirmed = run(sent, observe(stillOpen, 1000 + TEST_UNCONFIRMED_AFTER_MS));
    expect(unconfirmed.phase.name).toBe("unconfirmed");
    expect(run(unconfirmed, observe({ ...stillOpen, test: failure })).phase.name).toBe("test-failed");
  });

  test("a failure arriving with the closed presence keeps its reason", () => {
    const failed = run(sent, observe({ presence: "closed", test: failure }, 70_000));
    expect(failed.phase).toEqual({ name: "test-failed", reason: "no overlay" });
    expect(run(failed, observe({ presence: "closed", test: failure }, 71_000)).phase.name).toBe("test-failed");
  });

  test("Try again with the overlay gone goes back to waiting for it", () => {
    const failed = run(sent, observe({ presence: "closed", test: failure }, 70_000));
    const resent = run(failed, { type: "send" });
    expect(run(resent, observe({ presence: "closed" }, 72_000)).phase.name).toBe("waiting");
  });
});
