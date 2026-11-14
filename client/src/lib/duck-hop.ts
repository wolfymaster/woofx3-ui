/**
 * The duck game behind the finish page's wait: a duck walks and hops along the
 * level meter's bars. This file is the rules only, as pure functions over a
 * state value, so the component owns the clock, the keys and the pixels and the
 * rules can be tested with a fixed time step.
 *
 * Heights are measured upward from the bottom of the game layer, in pixels.
 * Positions are measured from its left edge.
 */

export interface DuckHopConfig {
  /** Walking speed while a direction is held, in px/s. */
  moveSpeed: number;
  /** Downward acceleration in the air, in px/s². */
  gravity: number;
  /** Upward speed at the start of a hop, in px/s. */
  hopSpeed: number;
  /** Half the width of the part of the duck that stands on a bar. */
  footHalfWidth: number;
  /** A bar this much taller than the feet is walked up; more than this is a wall. */
  stepUp: number;
  /**
   * A bar can only be a wall when its fixed height is this much taller than the
   * bar the duck came from. The bars pulse, so judging walls by their live
   * height alone would end runs at random; the fixed profile makes a rhythm a
   * player can learn.
   */
  stepWall: number;
  /** No walls this long after a start, so there is room to get going. */
  graceMs: number;
  /** A drop this small is walked down rather than fallen. */
  snapDown: number;
  /** A hop pressed this long before landing still counts. */
  hopBufferMs: number;
  /** How long the duck stays down after hitting a wall. */
  downBeatMs: number;
  /** The duck stops at this x at the left edge of the screen. */
  minX: number;
  /** Time each running frame stays on screen. */
  runFrameMs: number;
}

export const DEFAULT_DUCK_HOP_CONFIG: DuckHopConfig = {
  moveSpeed: 150,
  gravity: 2600,
  hopSpeed: 760,
  footHalfWidth: 7,
  stepUp: 14,
  stepWall: 28,
  graceMs: 450,
  snapDown: 6,
  hopBufferMs: 120,
  downBeatMs: 650,
  minX: 22,
  runFrameMs: 85,
};

/** The bars, left to right, as laid out on screen. */
export interface Course {
  left: readonly number[];
  right: readonly number[];
  /** Layout height of each bar, ignoring the pulse. */
  fixedHeight: readonly number[];
}

/** What the duck can stand on right now, read from the live (pulsing) bars. */
export interface Surface {
  /** Height of the meter's baseline, where there is no bar. */
  floor: number;
  /** Current height of the top of a bar. */
  top(bar: number): number;
}

export const DUCK_MODES = { idle: "idle", running: "running", down: "down" } as const;
export type DuckMode = (typeof DUCK_MODES)[keyof typeof DUCK_MODES];

export interface DuckState {
  mode: DuckMode;
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  facing: 1 | -1;
  moving: boolean;
  lap: number;
  /** Bars cleared in this run, counting laps. */
  bars: number;
  runClockMs: number;
  hopAskedAtMs: number;
  downUntilMs: number;
  graceUntilMs: number;
}

export interface DuckInput {
  left: boolean;
  right: boolean;
}

export const DUCK_EVENTS = { wall: "wall", lap: "lap", restart: "restart" } as const;
export type DuckEvent = (typeof DUCK_EVENTS)[keyof typeof DUCK_EVENTS];

const NEVER = Number.NEGATIVE_INFINITY;

/** The sprite sheet's frames: the run cycle, then the poses used off the ground. */
export const SPRITE_FRAMES = { count: 6, air: 2, idle: 3 } as const;

function barCount(course: Course): number {
  return course.left.length;
}

/** The bar a position is over, or -1 off either end. A bar owns the gap after it. */
export function barAt(course: Course, px: number): number {
  const last = barCount(course) - 1;
  for (let bar = 0; bar <= last; bar++) {
    const edge = bar < last ? course.left[bar + 1] : course.right[bar];
    if (px >= course.left[bar] && px < edge) {
      return bar;
    }
  }
  return -1;
}

function groundAt(course: Course, surface: Surface, x: number, config: DuckHopConfig): number {
  const low = x - config.footHalfWidth;
  const high = x + config.footHalfWidth;
  const last = barCount(course) - 1;
  let ground = surface.floor;
  for (let bar = 0; bar <= last; bar++) {
    const edge = bar < last ? course.left[bar + 1] : course.right[bar];
    if (edge > low && course.left[bar] < high) {
      ground = Math.max(ground, surface.top(bar));
    }
  }
  return ground;
}

function startX(course: Course): number {
  return (course.left[0] + course.right[0]) / 2;
}

/** A duck standing on the first bar, waiting for the first key. */
export function createGame(course: Course, surface: Surface, config: DuckHopConfig): DuckState {
  const x = startX(course);
  return {
    mode: DUCK_MODES.idle,
    x,
    y: groundAt(course, surface, x, config),
    vy: 0,
    grounded: true,
    facing: 1,
    moving: false,
    lap: 1,
    bars: 0,
    runClockMs: 0,
    hopAskedAtMs: NEVER,
    downUntilMs: 0,
    graceUntilMs: 0,
  };
}

/** The first key press starts the run; later ones change nothing. */
export function wake(state: DuckState, nowMs: number, config: DuckHopConfig): DuckState {
  if (state.mode !== DUCK_MODES.idle) {
    return state;
  }
  return { ...state, mode: DUCK_MODES.running, graceUntilMs: nowMs + config.graceMs };
}

export function askHop(state: DuckState, nowMs: number): DuckState {
  return { ...state, hopAskedAtMs: nowMs };
}

export interface StepResult {
  state: DuckState;
  events: DuckEvent[];
}

/** Advances the game by `dtSeconds`; `nowMs` is the same clock the key presses were stamped with. */
export function stepGame(
  state: DuckState,
  input: DuckInput,
  course: Course,
  surface: Surface,
  dtSeconds: number,
  nowMs: number,
  config: DuckHopConfig
): StepResult {
  if (state.mode === DUCK_MODES.idle) {
    return { state: { ...state, y: groundAt(course, surface, state.x, config) }, events: [] };
  }
  if (state.mode === DUCK_MODES.down) {
    if (nowMs < state.downUntilMs) {
      return { state, events: [] };
    }
    const fresh = createGame(course, surface, config);
    return {
      state: { ...fresh, mode: DUCK_MODES.running, graceUntilMs: nowMs + config.graceMs },
      events: [DUCK_EVENTS.restart],
    };
  }

  const events: DuckEvent[] = [];
  let next = { ...state };
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  next.moving = direction !== 0;
  const standingOn = barAt(course, next.x);
  if (direction !== 0) {
    next.facing = direction > 0 ? 1 : -1;
    next.runClockMs += dtSeconds * 1000;
    next.x = Math.max(config.minX, next.x + direction * config.moveSpeed * dtSeconds);
  }

  const lastBar = barCount(course) - 1;
  if (next.x - config.footHalfWidth > course.right[lastBar]) {
    next = { ...next, lap: next.lap + 1, x: startX(course), graceUntilMs: nowMs + config.graceMs };
    events.push(DUCK_EVENTS.lap);
  }

  // Stepping onto a much taller bar than the one underfoot is walking into its
  // side, from either direction.
  const front = barAt(course, next.x + direction * config.footHalfWidth);
  if (direction !== 0 && front >= 0 && standingOn >= 0 && front !== standingOn) {
    const tallerThanLast = course.fixedHeight[front] - course.fixedHeight[standingOn] > config.stepWall;
    const inTheWay = surface.top(front) > next.y + config.stepUp;
    if (nowMs > next.graceUntilMs && tallerThanLast && inTheWay) {
      events.push(DUCK_EVENTS.wall);
      return {
        state: { ...next, mode: DUCK_MODES.down, moving: false, downUntilMs: nowMs + config.downBeatMs },
        events,
      };
    }
  }

  const ground = groundAt(course, surface, next.x, config);
  if (next.grounded && nowMs - next.hopAskedAtMs <= config.hopBufferMs) {
    next = { ...next, vy: config.hopSpeed, grounded: false, hopAskedAtMs: NEVER };
  }
  if (next.grounded) {
    if (next.y - ground > config.snapDown) {
      next = { ...next, grounded: false, vy: 0 };
    } else {
      next.y = ground;
    }
  }
  if (!next.grounded) {
    const vy = next.vy - config.gravity * dtSeconds;
    const y = next.y + vy * dtSeconds;
    if (y <= ground) {
      // Landing, or a rising bar carrying the duck up with it.
      next = { ...next, y: ground, vy: 0, grounded: true };
    } else {
      next = { ...next, y, vy };
    }
  }

  const progress = (next.lap - 1) * barCount(course) + Math.max(0, barAt(course, next.x));
  next.bars = Math.max(next.bars, progress);
  return { state: next, events };
}

/** Which sprite frame to draw. */
export function spriteFrame(state: DuckState, config: DuckHopConfig): number {
  if (!state.grounded) {
    return SPRITE_FRAMES.air;
  }
  if (state.moving && state.mode === DUCK_MODES.running) {
    return Math.floor(state.runClockMs / config.runFrameMs) % SPRITE_FRAMES.count;
  }
  return SPRITE_FRAMES.idle;
}
