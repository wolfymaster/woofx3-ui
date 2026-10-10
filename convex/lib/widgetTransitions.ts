// How a placed widget enters and leaves. A placement on a scene or in an alert
// layout may carry `transitionIn` and `transitionOut`; the engine's overlay
// plays them. Must match the engine's module SDK
// (woofx3 shared/clients/typescript/module-sdk/src/widget-transitions.ts,
// docs/services/widget-transitions.md), which refuses anything else.

/** Types every widget can play: the overlay animates the placement's box. */
export const GENERIC_TRANSITIONS = [
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Slide" },
  { id: "zoom", label: "Zoom" },
  { id: "bounce", label: "Bounce" },
  { id: "spin", label: "Spin" },
  { id: "pop", label: "Pop" },
  { id: "blur", label: "Blur" },
] as const;

export const TRANSITION_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export const TRANSITION_EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
export type TransitionEasing = (typeof TRANSITION_EASINGS)[number];

export const MIN_TRANSITION_MS = 50;
export const MAX_TRANSITION_MS = 10_000;
export const DEFAULT_TRANSITION_MS = 500;

const TRANSITION_ID = /^[a-z][a-z0-9-]{0,31}$/;

export interface PlacementTransition {
  type: string;
  durationMs: number;
  easing?: TransitionEasing;
  /** Only for `slide`. */
  direction?: TransitionDirection;
}

/** A transition type a widget declares for its own content. */
export interface WidgetTransitionOption {
  id: string;
  label: string;
}

export function isGenericTransition(type: string): boolean {
  return GENERIC_TRANSITIONS.some((t) => t.id === type);
}

/**
 * A stored `transitionIn` / `transitionOut`, or undefined when there is none
 * or it is not one the engine would accept. A placement written by hand or by
 * an older editor can carry anything.
 */
export function readPlacementTransition(value: unknown): PlacementTransition | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["type", "durationMs", "easing", "direction"].includes(key))) {
    return undefined;
  }
  if (typeof raw.type !== "string" || !TRANSITION_ID.test(raw.type)) {
    return undefined;
  }
  if (
    typeof raw.durationMs !== "number" ||
    !Number.isInteger(raw.durationMs) ||
    raw.durationMs < MIN_TRANSITION_MS ||
    raw.durationMs > MAX_TRANSITION_MS
  ) {
    return undefined;
  }
  const transition: PlacementTransition = { type: raw.type, durationMs: raw.durationMs };
  if (raw.easing !== undefined) {
    if (!(TRANSITION_EASINGS as readonly unknown[]).includes(raw.easing)) {
      return undefined;
    }
    transition.easing = raw.easing as TransitionEasing;
  }
  if (raw.direction !== undefined) {
    if (raw.type !== "slide" || !(TRANSITION_DIRECTIONS as readonly unknown[]).includes(raw.direction)) {
      return undefined;
    }
    transition.direction = raw.direction as TransitionDirection;
  }
  return transition;
}

/** A placement's transitions, holding only those it has. */
export function placementTransitions(source: { transitionIn?: unknown; transitionOut?: unknown }): {
  transitionIn?: PlacementTransition;
  transitionOut?: PlacementTransition;
} {
  const transitions: { transitionIn?: PlacementTransition; transitionOut?: PlacementTransition } = {};
  const transitionIn = readPlacementTransition(source.transitionIn);
  if (transitionIn) {
    transitions.transitionIn = transitionIn;
  }
  const transitionOut = readPlacementTransition(source.transitionOut);
  if (transitionOut) {
    transitions.transitionOut = transitionOut;
  }
  return transitions;
}

/**
 * The transitions a widget definition declares, from an engine payload. Read
 * from an untyped value because the field arrived after the payload types it
 * is carried on; entries without an id are dropped.
 */
export function readWidgetTransitions(definition: unknown): WidgetTransitionOption[] {
  const raw = typeof definition === "object" && definition !== null ? (definition as { transitions?: unknown }) : {};
  if (!Array.isArray(raw.transitions)) {
    return [];
  }
  const options: WidgetTransitionOption[] = [];
  for (const entry of raw.transitions) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, label } = entry as { id?: unknown; label?: unknown };
    if (typeof id !== "string" || !TRANSITION_ID.test(id) || isGenericTransition(id)) {
      continue;
    }
    options.push({ id, label: typeof label === "string" && label.trim() !== "" ? label.trim() : id });
  }
  return options;
}
