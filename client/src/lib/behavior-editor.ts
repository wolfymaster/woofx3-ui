import { type CatalogWidget, offeredKinds } from "@woofx3/scene/editor";
import {
  type AnchorKind,
  type AnimationKeyframe,
  type BehaviorDocument,
  type BehaviorId,
  compileAnimation,
  type Easing,
  type EffectParamSpec,
  effectParamSpecs,
  MAX_TIMING_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  type NodeId,
  type ResolvedTimeline,
  type Timing,
  TRANSITION_DIRECTIONS,
  type TransitionDirection,
  type TransitionPhase,
} from "@woofx3/scene/model";

/**
 * What the inspector shows of a widget's behaviors (`@woofx3/scene/model`):
 * its Enter and Exit transitions, its effects, and on an alert the window it
 * plays in. Every edit goes through the composition editor's `behaviors`
 * methods, which check it against the registry; these only read the document
 * and shape the values a control hands back.
 */

/** One behavior with its id, as the inspector lists it. */
export interface BehaviorEntry {
  id: BehaviorId;
  behavior: BehaviorDocument;
}

/** The value of the transition picker for no transition. */
export const NO_TRANSITION = "none";

const HOST_KIND_LABELS: Readonly<Record<string, string>> = {
  fade: "Fade",
  slide: "Slide",
  zoom: "Zoom",
  bounce: "Bounce",
  spin: "Spin",
  pop: "Pop",
  blur: "Blur",
  shake: "Shake",
  pulse: "Pulse",
  float: "Float",
  glow: "Glow",
  flash: "Flash",
};

export const DIRECTION_LABELS: Readonly<Record<TransitionDirection, string>> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

/**
 * One option of a kind picker. `host` kinds the overlay plays on any widget;
 * `widget` kinds the widget declares and plays itself; `unavailable` is a
 * stored kind this widget is not offered (no longer installed, or no longer
 * declared), shown so the picker never claims a behavior is something else.
 */
export interface KindOption {
  value: string;
  label: string;
  group: "host" | "widget" | "unavailable";
}

/**
 * What a kind picker offers for a `type` behavior on a placement of `row`:
 * the host's kinds, then the widget's, then `current` when it is neither.
 */
export function kindOptions(
  row: CatalogWidget | undefined,
  type: "transition" | "effect",
  current?: string
): KindOption[] {
  const options: KindOption[] = [];
  for (const offered of offeredKinds(row, type)) {
    if (options.some((option) => option.value === offered.kind)) {
      continue;
    }
    options.push(
      offered.executor === "host"
        ? { value: offered.kind, label: HOST_KIND_LABELS[offered.kind] ?? offered.kind, group: "host" }
        : { value: offered.kind, label: offered.label ?? offered.kind, group: "widget" }
    );
  }
  if (current !== undefined && current !== NO_TRANSITION && !options.some((option) => option.value === current)) {
    options.push({ value: current, label: `${current} (not available)`, group: "unavailable" });
  }
  return options;
}

/** `target`'s behaviors of `type`, in their order. */
export function behaviorsOf(
  behaviors: Readonly<Record<BehaviorId, BehaviorDocument>>,
  target: NodeId,
  type: string
): BehaviorEntry[] {
  return Object.entries(behaviors)
    .filter(([, behavior]) => behavior.target === target && behavior.type === type)
    .map(([id, behavior]) => ({ id, behavior }))
    .sort((a, b) => compareText(a.behavior.order, b.behavior.order) || compareText(a.id, b.id));
}

/** `target`'s transition for `phase`: the first, when concurrent edits left more than one. */
export function transitionOf(
  behaviors: Readonly<Record<BehaviorId, BehaviorDocument>>,
  target: NodeId,
  phase: TransitionPhase
): BehaviorEntry | null {
  return behaviorsOf(behaviors, target, "transition").find((entry) => entry.behavior.params.phase === phase) ?? null;
}

/** The easing a new transition of `phase` takes. Must match the scene model's default. */
export function defaultTransitionEasing(phase: TransitionPhase): Easing {
  return phase === "in" ? "ease-out" : "ease-in";
}

/** A typed duration held to what a transition may last, or null for text that is not a number. */
export function transitionDurationOf(text: string): number | null {
  const parsed = Number(text);
  if (text.trim() === "" || !Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, Math.round(parsed)));
}

/**
 * A transition's params after picking `kind`: its phase, and for a slide a
 * direction (the one it had, else up). Another kind takes no direction,
 * and the engine refuses a param a host kind does not take.
 */
export function transitionParamsFor(
  kind: string,
  phase: TransitionPhase,
  previous?: BehaviorDocument
): Record<string, unknown> {
  if (kind !== "slide") {
    return { phase };
  }
  const direction = previous?.params.direction;
  return {
    phase,
    direction: (TRANSITION_DIRECTIONS as readonly unknown[]).includes(direction) ? direction : "up",
  };
}

// ---- effect params -----------------------------------------------------------

/** One param of an effect, as the inspector renders an input for it: the registry's spec. */
export type EffectParamField = EffectParamSpec;

/**
 * The params a host effect `kind` takes, with the bounds the engine checks
 * and the values the overlay plays when one is absent. Empty for a kind the
 * widget plays itself, whose params are the widget's own.
 */
export function effectParamFields(kind: string): readonly EffectParamField[] {
  return effectParamSpecs(kind);
}

/** What an input shows for `field`: the stored param, else the value the overlay plays without one. */
export function paramValue(params: Record<string, unknown>, field: EffectParamField): number | string {
  const value = params[field.name];
  if (field.input === "color") {
    return typeof value === "string" ? value : field.defaultValue;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : field.defaultValue;
}

/**
 * `params` with `field` set from what was typed, held to its bounds; null when
 * the text is not a value the field takes (not a number, a number at an
 * exclusive minimum, or a colour that is not hex), so the input goes back.
 */
export function withParam(
  params: Record<string, unknown>,
  field: EffectParamField,
  text: string
): Record<string, unknown> | null {
  if (field.input === "color") {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)
      ? { ...params, [field.name]: text }
      : null;
  }
  const parsed = Number(text);
  if (text.trim() === "" || !Number.isFinite(parsed)) {
    return null;
  }
  let value = parsed;
  if (field.max !== undefined) {
    value = Math.min(field.max, value);
  }
  if (field.min !== undefined) {
    if (field.minExclusive ? value <= field.min : value < field.min) {
      if (field.minExclusive) {
        return null;
      }
      value = field.min;
    }
  }
  return { ...params, [field.name]: value };
}

// ---- timing ------------------------------------------------------------------

/** Anchors an effect may start from, in the order a picker lists them. */
const EFFECT_ANCHORS: readonly AnchorKind[] = ["enter", "start"];

/** The anchors an effect may start from among those the editor allows here (`capabilities.anchors`). */
export function effectAnchors(allowed: readonly AnchorKind[]): AnchorKind[] {
  return EFFECT_ANCHORS.filter((anchor) => allowed.includes(anchor));
}

export const ANCHOR_LABELS: Readonly<Partial<Record<AnchorKind, string>>> = {
  enter: "When it enters",
  start: "When the alert starts",
};

/** Whole milliseconds from seconds, held to what a timing may give; null for text that is not a number. */
export function timingMsOf(text: string, { min = 0 }: { min?: number } = {}): number | null {
  const parsed = Number(text);
  if (text.trim() === "" || !Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(MAX_TIMING_MS, Math.max(min, Math.round(parsed * 1000)));
}

/** Milliseconds as the inspector's seconds readouts show them: to a tenth, whole seconds bare. */
export function formatMs(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}

/** When an effect runs, in a few words: "When it enters, until it leaves", "2s after the alert starts, for 3s". */
export function effectTimingLabel(timing: Timing): string {
  const from =
    timing.offsetMs === 0
      ? (ANCHOR_LABELS[timing.anchor] ?? timing.anchor)
      : `${formatMs(timing.offsetMs)} after ${timing.anchor === "start" ? "the alert starts" : "it enters"}`;
  const length = timing.durationMs === "until-exit" ? "until it leaves" : `for ${formatMs(timing.durationMs)}`;
  return `${from}, ${length}`;
}

// ---- an alert layer's window ------------------------------------------------

/**
 * When a layer plays within its alert: how long after the alert starts it
 * enters, and how long it stays (null: until it completes, or the alert
 * ends). Stored as the layer's `activity` behavior; a layer without one
 * enters as the alert starts and stays until it completes.
 */
export interface LayerWindow {
  startMs: number;
  stayMs: number | null;
}

export const DEFAULT_LAYER_WINDOW: LayerWindow = { startMs: 0, stayMs: null };

/** `target`'s activity: the first, when concurrent edits left more than one. */
export function activityOf(
  behaviors: Readonly<Record<BehaviorId, BehaviorDocument>>,
  target: NodeId
): BehaviorEntry | null {
  return behaviorsOf(behaviors, target, "activity")[0] ?? null;
}

/** The window an activity sets. One anchored elsewhere than the alert's start reads from its offset alone. */
export function layerWindowOf(activity: BehaviorDocument | null): LayerWindow {
  if (activity === null) {
    return DEFAULT_LAYER_WINDOW;
  }
  const { offsetMs, durationMs } = activity.timing;
  return { startMs: Math.max(0, offsetMs), stayMs: durationMs === "until-exit" ? null : durationMs };
}

/** The timing an activity takes for `window`. */
export function activityTimingOf(window: LayerWindow): Partial<Timing> {
  return { anchor: "start", offsetMs: window.startMs, durationMs: window.stayMs ?? "until-exit" };
}

/** What to do to a layer's activity so it sets `window`. */
export type ActivityEdit =
  | { op: "none" }
  | { op: "add"; timing: Partial<Timing> }
  | { op: "patch"; id: BehaviorId; timing: Timing }
  | { op: "remove"; id: BehaviorId };

/**
 * The edit that gives a layer `window`: none when it already has it, the
 * activity removed when the window is the one a layer has without one (so a
 * layer nobody timed stores nothing), else added or changed.
 */
export function activityEditFor(current: BehaviorEntry | null, window: LayerWindow): ActivityEdit {
  const isDefault = window.startMs === 0 && window.stayMs === null;
  if (current === null) {
    return isDefault ? { op: "none" } : { op: "add", timing: activityTimingOf(window) };
  }
  if (isDefault) {
    return { op: "remove", id: current.id };
  }
  const next: Timing = { ...current.behavior.timing, ...activityTimingOf(window) } as Timing;
  const was = current.behavior.timing;
  if (next.anchor === was.anchor && next.offsetMs === was.offsetMs && next.durationMs === was.durationMs) {
    return { op: "none" };
  }
  const { node: _node, ...withoutNode } = next;
  return { op: "patch", id: current.id, timing: withoutNode };
}

/** A layer's window in a few words: "Starts with the alert, until it completes", "Starts after 2s, stays 5s". */
export function layerWindowLabel(window: LayerWindow): string {
  const start = window.startMs === 0 ? "Starts with the alert" : `Starts after ${formatMs(window.startMs)}`;
  const stay = window.stayMs === null ? "until it completes" : `stays ${formatMs(window.stayMs)}`;
  return `${start}, ${stay}`;
}

/** Whether any layer has a window of its own, which is when the alert's length comes from its resolved tracks. */
export function hasActivities(behaviors: Readonly<Record<BehaviorId, BehaviorDocument>>): boolean {
  return Object.values(behaviors).some((behavior) => behavior.type === "activity");
}

/** A layer's resolved window for the layers list: "2s–7s", or "from 2s" when it has no end of its own. */
export function trackWindowLabel(tracks: ResolvedTimeline, id: NodeId): string | null {
  const track = tracks.widgets[id];
  if (track === undefined || track.enterMs === null) {
    return null;
  }
  return track.leaveMs === null
    ? `from ${formatMs(track.enterMs)}`
    : `${formatMs(track.enterMs)}–${formatMs(track.leaveMs)}`;
}

// ---- preview -------------------------------------------------------------------

/** Longest an effect's preview plays, so a repeating one does not run on forever. */
export const EFFECT_PREVIEW_MS = 3_000;

/** What a preview swatch plays: `element.animate(keyframes, options)`. */
export interface PreviewAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

/**
 * The animation the overlay plays for `behavior`, from its start, for the
 * inspector's stand-in box: a transition once over its duration, an effect
 * for its length up to EFFECT_PREVIEW_MS. Null for a kind the widget plays
 * itself, which only the overlay can show, and for params the overlay would
 * refuse.
 */
export function previewAnimation(behavior: BehaviorDocument): PreviewAnimation | null {
  const lengthMs =
    behavior.type === "transition"
      ? behavior.timing.durationMs
      : behavior.timing.durationMs === "until-exit"
        ? EFFECT_PREVIEW_MS
        : Math.min(EFFECT_PREVIEW_MS, behavior.timing.durationMs);
  if (typeof lengthMs !== "number") {
    return null;
  }
  let spec: ReturnType<typeof compileAnimation>;
  try {
    spec = compileAnimation(behavior, { startMs: 0, endMs: lengthMs });
  } catch {
    return null;
  }
  if (spec === null) {
    return null;
  }
  return {
    keyframes: spec.keyframes.map((frame: AnimationKeyframe) => ({ ...frame }) as Keyframe),
    options: {
      duration: spec.timing.duration,
      easing: spec.timing.easing,
      iterations: spec.timing.iterations,
      // A transition's preview ends where it started rather than holding its last frame.
      fill: "none",
    },
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
