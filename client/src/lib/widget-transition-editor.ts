import {
  DEFAULT_TRANSITION_MS,
  GENERIC_TRANSITIONS,
  isGenericTransition,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  type PlacementTransition,
  type TransitionDirection,
  type TransitionEasing,
  type WidgetTransitionOption,
} from "@convex/lib/widgetTransitions";

export type TransitionPhase = "in" | "out";

/** What the type picker offers: none, the generic types, then the widget's own. */
export interface TransitionTypeOption {
  value: string;
  label: string;
  group: "none" | "generic" | "widget";
}

export const NO_TRANSITION = "none";

export function transitionTypeOptions(declared: readonly WidgetTransitionOption[]): TransitionTypeOption[] {
  return [
    { value: NO_TRANSITION, label: "None", group: "none" },
    ...GENERIC_TRANSITIONS.map((t) => ({ value: t.id, label: t.label, group: "generic" as const })),
    ...declared.map((t) => ({ value: t.id, label: t.label, group: "widget" as const })),
  ];
}

/**
 * The transition after picking `type`, keeping what still applies: the
 * duration and easing carry over, and a direction only to another slide.
 */
export function withTransitionType(
  previous: PlacementTransition | undefined,
  type: string
): PlacementTransition | undefined {
  if (type === NO_TRANSITION) {
    return undefined;
  }
  const next: PlacementTransition = { type, durationMs: previous?.durationMs ?? DEFAULT_TRANSITION_MS };
  if (previous?.easing) {
    next.easing = previous.easing;
  }
  if (type === "slide" && previous?.direction) {
    next.direction = previous.direction;
  }
  return next;
}

/** The transition with a new duration, held to what the engine accepts. */
export function withTransitionDuration(transition: PlacementTransition, durationMs: number): PlacementTransition {
  if (!Number.isFinite(durationMs)) {
    return transition;
  }
  const clamped = Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, Math.round(durationMs)));
  return { ...transition, durationMs: clamped };
}

/** The transition with a new easing; `undefined` returns to the default for its phase. */
export function withTransitionEasing(
  transition: PlacementTransition,
  easing: TransitionEasing | undefined
): PlacementTransition {
  const { easing: _previous, ...rest } = transition;
  return easing ? { ...rest, easing } : rest;
}

export function withTransitionDirection(
  transition: PlacementTransition,
  direction: TransitionDirection
): PlacementTransition {
  return { ...transition, direction };
}

/**
 * The type to show in the picker. A stored type the widget no longer declares
 * reads as none, since the overlay does not play it.
 */
export function pickerValue(
  transition: PlacementTransition | undefined,
  declared: readonly WidgetTransitionOption[]
): string {
  if (!transition) {
    return NO_TRANSITION;
  }
  if (isGenericTransition(transition.type) || declared.some((t) => t.id === transition.type)) {
    return transition.type;
  }
  return NO_TRANSITION;
}

/** The easing a transition plays with when it names none. Must match the engine's. */
export function defaultEasing(phase: TransitionPhase): TransitionEasing {
  return phase === "in" ? "ease-out" : "ease-in";
}

const SHOWN: Keyframe = { opacity: 1, transform: "none", filter: "none" };

const SLIDE_OFFSET: Record<TransitionDirection, { enter: string; leave: string }> = {
  up: { enter: "translate(0, 100%)", leave: "translate(0, -100%)" },
  down: { enter: "translate(0, -100%)", leave: "translate(0, 100%)" },
  left: { enter: "translate(100%, 0)", leave: "translate(-100%, 0)" },
  right: { enter: "translate(-100%, 0)", leave: "translate(100%, 0)" },
};

/**
 * The keyframes the overlay plays for a generic transition, for the
 * inspector's preview. Must match `genericKeyframes` in the engine's
 * sceneManager/public/scene-manager/transitions.ts. Null for a type the
 * widget plays itself, which only the widget can show.
 */
export function previewKeyframes(transition: PlacementTransition, phase: TransitionPhase): Keyframe[] | null {
  if (!isGenericTransition(transition.type)) {
    return null;
  }
  const entrance = entranceKeyframes(transition, phase).map((frame) => ({ ...SHOWN, ...frame }));
  if (phase === "in") {
    return entrance;
  }
  return entrance
    .slice()
    .reverse()
    .map((frame) =>
      frame.offset === undefined || frame.offset === null ? frame : { ...frame, offset: 1 - frame.offset }
    );
}

function entranceKeyframes(transition: PlacementTransition, phase: TransitionPhase): Keyframe[] {
  switch (transition.type) {
    case "fade":
      return [{ opacity: 0 }, { opacity: 1 }];
    case "slide": {
      const offset = SLIDE_OFFSET[transition.direction ?? "up"];
      return [{ opacity: 0, transform: phase === "in" ? offset.enter : offset.leave }, SHOWN];
    }
    case "zoom":
      return [{ opacity: 0, transform: "scale(0.5)" }, SHOWN];
    case "bounce":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.5 },
        { transform: "scale(0.94)", offset: 0.75 },
        SHOWN,
      ];
    case "spin":
      return [{ opacity: 0, transform: "rotate(-360deg) scale(0)" }, SHOWN];
    case "pop":
      return [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1.15)", offset: 0.7 }, SHOWN];
    case "blur":
      return [{ opacity: 0, filter: "blur(16px)" }, SHOWN];
    default:
      return [SHOWN, SHOWN];
  }
}
