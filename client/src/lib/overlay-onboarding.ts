import { alertWidgetNamesOf, DEFAULT_ALERT_WIDGET_NAME, placedWidgetsOf } from "@shared/alert-widgets";
import type { DefaultSeedStatus, EngineAlert, OverlayPresence, SceneRecord } from "@/engine/types";
import { alertOfTestEvent } from "@/lib/alert-envelope";

// The overlay page's state machine. What the server knows decides most of it,
// so a refresh lands in the right place; only a test in flight lives here, and
// a refresh forgets it, returning to "connected" to send another.

export const OVERLAY_HINT_AFTER_MS = 60_000;
export const OVERLAY_TROUBLESHOOT_AFTER_MS = 180_000;
/** No engine service reports an alert that never played in time, so the page gives up by itself. */
export const TEST_UNCONFIRMED_AFTER_MS = 60_000;
/** How long a seed item may sit on a recorded error before the page stops presenting it as ordinary progress. */
export const SEED_SLOW_AFTER_MS = 60_000;
/**
 * Seeded scenes and workflows reach the reads by webhook, a moment after the
 * seed records their ids, so one absent for less than this has not been deleted.
 */
export const SEED_MIRROR_GRACE_MS = 20_000;

/** Must match the follow entry in DEFAULT_ALERT_ITEMS, shared/default-seed.ts. */
const FOLLOW_ITEM_ID = "follow";
const ALERT_SURFACE = "alert";

export type EngineStage = "building" | "failed" | "ready";
/** "absent": recorded as seeded and not in the reads. "none": nothing was ever seeded and nothing stands in. */
export type SceneFact = "loading" | "found" | "pending" | "failed" | "absent" | "none";
export type FollowFact = "pending" | "ready" | "failed" | "absent" | "none";
export type TestOutcome = { kind: "none" } | { kind: "completed" } | { kind: "failed"; reason: string | null };

export interface OverlayFacts {
  engine: EngineStage;
  scene: SceneFact;
  follow: FollowFact;
  /** A seed item failed an attempt and is still waiting on another; see `seedHasRecordedError`. */
  seedError: boolean;
  /** Undefined before the first answer, which is no moment to say "waiting" to a refresh. */
  presence: OverlayPresence | undefined;
  test: TestOutcome;
}

export type OverlayPhase =
  | { name: "building" }
  | { name: "build-failed" }
  | { name: "preparing" }
  | { name: "seed-failed" }
  | { name: "no-scene" }
  /** `dropped`: the overlay was open and went away. */
  | { name: "waiting"; since: number; dropped: boolean }
  | { name: "connected" }
  | { name: "sending" }
  | { name: "playing"; sentAt: number }
  | { name: "unconfirmed" }
  | { name: "test-failed"; reason: string | null }
  | { name: "finished" };

export type FollowState = "pending" | "ready" | "failed" | "missing";

export interface OverlayState {
  phase: OverlayPhase;
  follow: FollowState;
  /** Every test sent since the overlay connected, so a late answer to an earlier one still counts. */
  triggerIds: readonly string[];
  sceneAbsentSince: number | null;
  followAbsentSince: number | null;
  seedErrorSince: number | null;
}

export const INITIAL_OVERLAY_STATE: OverlayState = {
  phase: { name: "building" },
  follow: "pending",
  triggerIds: [],
  sceneAbsentSince: null,
  followAbsentSince: null,
  seedErrorSince: null,
};

export type OverlayEvent =
  | { type: "observe"; facts: OverlayFacts; at: number }
  | { type: "send" }
  | { type: "sent"; triggerId: string; at: number }
  | { type: "send-refused" }
  | { type: "confirmed-seen" }
  | { type: "seed-retried" };

const BLOCKED_PHASES: ReadonlySet<OverlayPhase["name"]> = new Set([
  "building",
  "build-failed",
  "preparing",
  "seed-failed",
  "no-scene",
]);
const CAN_SEND: ReadonlySet<OverlayPhase["name"]> = new Set(["connected", "unconfirmed", "test-failed"]);

/** Whether the phase can still learn how the test it sent went. */
function isAwaitingTest(phase: OverlayPhase): boolean {
  return phase.name === "playing" || phase.name === "unconfirmed";
}

function followState(fact: FollowFact, absentSince: number | null, at: number): FollowState {
  if (fact === "absent") {
    return absentSince !== null && at - absentSince >= SEED_MIRROR_GRACE_MS ? "missing" : "pending";
  }
  if (fact === "none") {
    return "missing";
  }
  return fact;
}

/** The phase anything short of a usable overlay leaves the page on, or null once there is one. */
function blockedPhase(facts: OverlayFacts, sceneAbsentSince: number | null, at: number): OverlayPhase | null {
  if (facts.engine === "building") {
    return { name: "building" };
  }
  if (facts.engine === "failed") {
    return { name: "build-failed" };
  }
  switch (facts.scene) {
    case "found":
      return null;
    case "failed":
      return { name: "seed-failed" };
    case "none":
      return { name: "no-scene" };
    case "absent":
      return sceneAbsentSince !== null && at - sceneAbsentSince >= SEED_MIRROR_GRACE_MS
        ? { name: "no-scene" }
        : { name: "preparing" };
    default:
      return { name: "preparing" };
  }
}

function observe(state: OverlayState, facts: OverlayFacts, at: number): OverlayState {
  const sceneAbsentSince = facts.scene === "absent" ? (state.sceneAbsentSince ?? at) : null;
  const followAbsentSince = facts.follow === "absent" ? (state.followAbsentSince ?? at) : null;
  const base: OverlayState = {
    ...state,
    sceneAbsentSince,
    followAbsentSince,
    seedErrorSince: facts.seedError ? (state.seedErrorSince ?? at) : null,
    follow: followState(facts.follow, followAbsentSince, at),
  };
  const { phase } = state;

  // An alert that played is the goal, however the overlay has fared since: a
  // plain browser tab may well be closed straight after.
  if (phase.name === "finished") {
    return base;
  }
  if (state.triggerIds.length > 0 && facts.test.kind === "completed") {
    return { ...base, phase: { name: "finished" } };
  }

  const blocked = blockedPhase(facts, sceneAbsentSince, at);
  if (blocked !== null) {
    return { ...base, phase: blocked, triggerIds: [] };
  }

  const wasBlocked = BLOCKED_PHASES.has(phase.name);
  if (facts.presence === undefined && wasBlocked) {
    return { ...base, phase: { name: "preparing" } };
  }
  // Before the presence check: the engine's failure says why, where "disconnected"
  // would only guess. The reason stays up until Try again, even with the overlay gone.
  if (isAwaitingTest(phase) && facts.test.kind === "failed") {
    return { ...base, phase: { name: "test-failed", reason: facts.test.reason } };
  }
  if (facts.presence === "closed") {
    if (phase.name === "waiting" || phase.name === "test-failed") {
      return base;
    }
    return { ...base, phase: { name: "waiting", since: at, dropped: !wasBlocked }, triggerIds: [] };
  }

  if (facts.presence === "open") {
    if (phase.name === "waiting" || wasBlocked) {
      return { ...base, phase: { name: "connected" } };
    }
  } else if (wasBlocked) {
    return { ...base, phase: { name: "waiting", since: at, dropped: false } };
  }

  if (phase.name === "playing" && at - phase.sentAt >= TEST_UNCONFIRMED_AFTER_MS) {
    return { ...base, phase: { name: "unconfirmed" } };
  }
  return base;
}

/** The page's next state. An event that makes no sense in the current phase leaves it there. */
export function overlayReducer(state: OverlayState, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case "observe":
      return observe(state, event.facts, event.at);
    case "send":
      return CAN_SEND.has(state.phase.name) ? { ...state, phase: { name: "sending" } } : state;
    case "sent":
      // Anywhere else, the overlay dropped while the send was on its way.
      return state.phase.name === "sending"
        ? {
            ...state,
            phase: { name: "playing", sentAt: event.at },
            triggerIds: [...state.triggerIds, event.triggerId],
          }
        : state;
    case "send-refused":
      return state.phase.name === "sending" ? { ...state, phase: { name: "test-failed", reason: null } } : state;
    case "confirmed-seen":
      return state.phase.name === "unconfirmed" ? { ...state, phase: { name: "finished" } } : state;
    case "seed-retried":
      return { ...state, seedErrorSince: null };
  }
}

/** Whether an attempt at a seed item failed with retries still to come. A settled item is "failed" instead. */
export function seedHasRecordedError(seed: DefaultSeedStatus | null | undefined): boolean {
  if (!seed) {
    return false;
  }
  return [seed.scene, ...seed.alerts].some((item) => item.status === "pending" && item.error !== undefined);
}

/** Whether to say the seed is taking longer than usual and offer to try it now. */
export function seedIsSlow(state: OverlayState, at: number): boolean {
  return state.seedErrorSince !== null && at - state.seedErrorSince >= SEED_SLOW_AFTER_MS;
}

/** How much help the waiting phase offers after `now - since` of nothing connecting. */
export function waitingHelp(since: number, now: number): "none" | "hint" | "troubleshoot" {
  const waited = now - since;
  if (waited >= OVERLAY_TROUBLESHOOT_AFTER_MS) {
    return "troubleshoot";
  }
  return waited >= OVERLAY_HINT_AFTER_MS ? "hint" : "none";
}

/**
 * What became of the tests sent. A completed one counts whichever it was. Only
 * the latest failing counts as failed, because "Send again" has replaced the
 * ones before it.
 */
export function testOutcomeOf(alerts: readonly EngineAlert[], triggerIds: readonly string[]): TestOutcome {
  if (triggerIds.some((id) => alertOfTestEvent(alerts, id)?.status === "completed")) {
    return { kind: "completed" };
  }
  const latest = triggerIds.at(-1);
  const alert = latest === undefined ? undefined : alertOfTestEvent(alerts, latest);
  if (alert?.status === "failed" || alert?.status === "timed_out" || alert?.status === "skipped") {
    return { kind: "failed", reason: alert.error ?? null };
  }
  return { kind: "none" };
}

interface CatalogRow {
  widgetId: string;
  hostsSurface?: string;
}

/**
 * The scene the overlay URL should open: the seeded one, or failing that any
 * scene with the default alert widget, which is the same scene the seed itself
 * would accept and where an alert with no target plays. Never just the oldest:
 * an imported or marketplace scene may hold no alert widget at all.
 *
 * A deleted scene keeps its seeded status, so existence is read from `scenes`.
 */
export function overlaySceneOf(
  seed: DefaultSeedStatus | null | undefined,
  scenes: readonly SceneRecord[] | undefined,
  catalog: readonly CatalogRow[] | undefined
): { fact: SceneFact; scene?: SceneRecord } {
  if (!seed || scenes === undefined || catalog === undefined) {
    return { fact: "loading" };
  }
  const seeded = scenes.find((scene) => seed.scene.engineSceneId && scene.engineSceneId === seed.scene.engineSceneId);
  if (seeded) {
    return { fact: "found", scene: seeded };
  }
  const alertWidgetIds = new Set(
    catalog.filter((row) => row.hostsSurface === ALERT_SURFACE).map((row) => row.widgetId)
  );
  const standIn = scenes.find(
    (scene) =>
      scene.engineSceneId &&
      alertWidgetNamesOf(placedWidgetsOf(scene.widgets), alertWidgetIds).has(DEFAULT_ALERT_WIDGET_NAME)
  );
  if (standIn) {
    return { fact: "found", scene: standIn };
  }
  if (seed.scene.engineSceneId) {
    return { fact: "absent" };
  }
  if (seed.neverSeeded) {
    return { fact: "none" };
  }
  return { fact: seed.scene.status === "failed" ? "failed" : "pending" };
}

/** The seeded follow alert a test will play, checked against the workflows that still exist. */
export function followAlertOf(
  seed: DefaultSeedStatus | null | undefined,
  workflows: readonly { engineWorkflowId: string }[] | undefined
): { fact: FollowFact; event?: string } {
  if (!seed) {
    return { fact: "pending" };
  }
  const alert = seed.alerts.find((entry) => entry.itemId === FOLLOW_ITEM_ID);
  if (alert === undefined) {
    return { fact: "pending" };
  }
  if (alert.status === "installed" && alert.engineWorkflowId) {
    if (workflows === undefined) {
      return { fact: "pending", event: alert.event };
    }
    const exists = workflows.some((workflow) => workflow.engineWorkflowId === alert.engineWorkflowId);
    return { fact: exists ? "ready" : "absent", event: alert.event };
  }
  if (seed.neverSeeded) {
    return { fact: "none", event: alert.event };
  }
  return { fact: alert.status === "failed" ? "failed" : "pending", event: alert.event };
}
