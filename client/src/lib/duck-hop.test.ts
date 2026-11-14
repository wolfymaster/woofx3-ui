import { describe, expect, test } from "bun:test";
import {
  askHop,
  barAt,
  type Course,
  createGame,
  DEFAULT_DUCK_HOP_CONFIG,
  DUCK_EVENTS,
  DUCK_MODES,
  type DuckEvent,
  type DuckInput,
  type DuckState,
  SPRITE_FRAMES,
  type Surface,
  spriteFrame,
  stepGame,
  wake,
} from "@/lib/duck-hop";

const CONFIG = DEFAULT_DUCK_HOP_CONFIG;
const DT = 1 / 60;
const BAR_WIDTH = 20;
const BAR_STRIDE = 24;

function courseOf(heights: readonly number[]): Course {
  const left = heights.map((_, bar) => 24 + bar * BAR_STRIDE);
  return { left, right: left.map((edge) => edge + BAR_WIDTH), fixedHeight: heights };
}

/** A still meter: every bar is at its fixed height. */
function stillSurface(heights: readonly number[]): Surface {
  return { floor: 0, top: (bar) => heights[bar] };
}

const NO_KEYS: DuckInput = { left: false, right: false };
const RIGHT: DuckInput = { left: false, right: true };
const LEFT: DuckInput = { left: true, right: false };

interface Run {
  state: DuckState;
  events: DuckEvent[];
  nowMs: number;
}

function runFor(
  start: Run,
  input: DuckInput,
  seconds: number,
  course: Course,
  surface: Surface,
  until?: (state: DuckState) => boolean
): Run {
  let { state, nowMs } = start;
  const events = [...start.events];
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    nowMs += DT * 1000;
    const result = stepGame(state, input, course, surface, DT, nowMs, CONFIG);
    state = result.state;
    events.push(...result.events);
    if (until?.(state)) {
      break;
    }
  }
  return { state, events, nowMs };
}

function runningAt(course: Course, surface: Surface, x: number, nowMs: number): Run {
  const state = { ...wake(createGame(course, surface, CONFIG), 0, CONFIG), x, graceUntilMs: 0 };
  return { state, events: [], nowMs };
}

describe("stepGame", () => {
  const heights = [10, 10, 50, 50, 10, 10];
  const course = courseOf(heights);
  const surface = stillSurface(heights);

  test("the duck stands still on the first bar until a key is pressed", () => {
    const idle = createGame(course, surface, CONFIG);
    const after = runFor({ state: idle, events: [], nowMs: 0 }, RIGHT, 1, course, surface);
    expect(after.state.x).toBe(idle.x);
    expect(after.state.mode).toBe(DUCK_MODES.idle);
    expect(idle.y).toBe(10);
  });

  test("holding right walks at the configured speed and faces right", () => {
    const start = runningAt(course, surface, 34, 1000);
    const after = runFor(start, RIGHT, 0.2, course, surface, () => false);
    expect(after.state.x).toBeGreaterThan(34 + CONFIG.moveSpeed * 0.2 - 2);
    expect(after.state.facing).toBe(1);
  });

  test("with no key held the duck stays put", () => {
    const start = runningAt(course, surface, 34, 1000);
    expect(runFor(start, NO_KEYS, 1, course, surface).state.x).toBe(34);
  });

  test("holding left walks back, faces left and stops at the screen edge", () => {
    const start = runningAt(course, surface, 34, 1000);
    const after = runFor(start, LEFT, 2, course, surface);
    expect(after.state.x).toBe(CONFIG.minX);
    expect(after.state.facing).toBe(-1);
  });

  test("walking into a much taller bar is a wall", () => {
    const start = runningAt(course, surface, courseOf(heights).left[1] + 10, 1000);
    const after = runFor(start, RIGHT, 2, course, surface, (state) => state.mode === DUCK_MODES.down);
    expect(after.events).toContain(DUCK_EVENTS.wall);
    expect(after.state.mode).toBe(DUCK_MODES.down);
  });

  test("a wall also stops the duck walking back into a taller bar from the right", () => {
    const start = runningAt(course, surface, course.left[4] + 10, 1000);
    const afterStep = runFor(start, LEFT, 2, course, surface, (state) => state.mode === DUCK_MODES.down);
    // Bar 3 is much taller than bar 4, and the duck is on the floor-level side.
    expect(afterStep.events).toContain(DUCK_EVENTS.wall);
  });

  test("a hop in time clears the wall and lands on the taller bar", () => {
    const start = runningAt(course, surface, course.left[1] + 5, 1000);
    const hopped = { ...start, state: askHop(start.state, start.nowMs + 1) };
    const after = runFor(hopped, RIGHT, 0.4, course, surface);
    expect(after.events).not.toContain(DUCK_EVENTS.wall);
    const landed = runFor(after, NO_KEYS, 1, course, surface);
    expect(landed.state.grounded).toBe(true);
    expect(landed.state.y).toBe(50);
  });

  test("walls are ignored for a moment after a start", () => {
    const start = runningAt(course, surface, course.left[1] + 10, 1000);
    const graced = { ...start, state: { ...start.state, graceUntilMs: 1000 + CONFIG.graceMs } };
    const after = runFor(graced, RIGHT, 0.3, course, surface);
    expect(after.events).not.toContain(DUCK_EVENTS.wall);
    expect(after.state.y).toBe(50);
  });

  test("a step the bars' fixed heights do not call a wall is walked up even when the pulse makes it tall", () => {
    const flat = [10, 20, 20];
    const flatCourse = courseOf(flat);
    const pulsing: Surface = { floor: 0, top: (bar) => (bar === 1 ? 90 : flat[bar]) };
    const start = runningAt(flatCourse, pulsing, flatCourse.left[0] + 10, 1000);
    const after = runFor(start, RIGHT, 0.3, flatCourse, pulsing);
    expect(after.events).not.toContain(DUCK_EVENTS.wall);
  });

  test("a wall puts the duck down for a beat, then back on the first bar", () => {
    const down: DuckState = {
      ...runningAt(course, surface, 200, 0).state,
      mode: DUCK_MODES.down,
      lap: 3,
      downUntilMs: 1000,
    };
    const during = stepGame(down, RIGHT, course, surface, DT, 999, CONFIG);
    expect(during.state.mode).toBe(DUCK_MODES.down);
    expect(during.events).toEqual([]);
    const after = stepGame(down, RIGHT, course, surface, DT, 1000, CONFIG);
    expect(after.state.mode).toBe(DUCK_MODES.running);
    expect(after.state.lap).toBe(1);
    expect(after.state.x).toBe((course.left[0] + course.right[0]) / 2);
    expect(after.events).toEqual([DUCK_EVENTS.restart]);
  });

  test("walking off the last bar starts the next lap at the first bar", () => {
    const start = runningAt(course, surface, course.right[5] + CONFIG.footHalfWidth - 1, 1000);
    const after = runFor(start, RIGHT, 0.5, course, surface, (state) => state.lap === 2);
    expect(after.events).toContain(DUCK_EVENTS.lap);
    expect(after.state.lap).toBe(2);
    expect(after.state.x).toBeLessThan(course.right[0]);
  });

  test("bars cleared keeps counting across laps and never drops when walking back", () => {
    const start = runningAt(course, surface, course.left[4] + 10, 1000);
    const forward = runFor(start, RIGHT, 0.1, course, surface);
    const back = runFor(forward, LEFT, 0.3, course, surface);
    expect(back.state.bars).toBeGreaterThanOrEqual(4);
    expect(back.state.bars).toBe(forward.state.bars);
  });

  test("a hop pressed just before the duck lands still counts", () => {
    const start = runningAt(course, surface, 34, 1000);
    const firstStepMs = start.nowMs + DT * 1000;
    const early = { ...start, state: askHop(start.state, firstStepMs - CONFIG.hopBufferMs + 10) };
    expect(runFor(early, NO_KEYS, DT * 2, course, surface).state.grounded).toBe(false);
    const late = { ...start, state: askHop(start.state, firstStepMs - CONFIG.hopBufferMs - 50) };
    expect(runFor(late, NO_KEYS, DT * 2, course, surface).state.grounded).toBe(true);
  });

  test("a small drop is walked down and a large one is fallen", () => {
    const small = { ...runningAt(course, surface, 34, 1000) };
    small.state = { ...small.state, y: 10 + CONFIG.snapDown - 1 };
    expect(runFor(small, NO_KEYS, DT, course, surface).state.grounded).toBe(true);
    const large = { ...runningAt(course, surface, 34, 1000) };
    large.state = { ...large.state, y: 10 + CONFIG.snapDown + 20 };
    expect(runFor(large, NO_KEYS, DT, course, surface).state.grounded).toBe(false);
  });
});

describe("barAt", () => {
  const course = courseOf([10, 10, 10]);
  const cases: { name: string; px: number; want: number }[] = [
    { name: "left of the first bar", px: 10, want: -1 },
    { name: "on the first bar", px: 30, want: 0 },
    { name: "in the gap after a bar, which belongs to it", px: 24 + BAR_WIDTH + 2, want: 0 },
    { name: "on the last bar", px: 24 + 2 * BAR_STRIDE + 5, want: 2 },
    { name: "past the last bar", px: 24 + 2 * BAR_STRIDE + BAR_WIDTH + 1, want: -1 },
  ];
  for (const { name, px, want } of cases) {
    test(name, () => {
      expect(barAt(course, px)).toBe(want);
    });
  }
});

describe("spriteFrame", () => {
  const course = courseOf([10, 10]);
  const surface = stillSurface([10, 10]);
  const standing = createGame(course, surface, CONFIG);

  test("a standing duck uses the idle frame", () => {
    expect(spriteFrame(standing, CONFIG)).toBe(SPRITE_FRAMES.idle);
  });

  test("a hopping duck uses the air frame", () => {
    expect(spriteFrame({ ...standing, grounded: false }, CONFIG)).toBe(SPRITE_FRAMES.air);
  });

  test("a walking duck cycles through every frame", () => {
    const frames = new Set<number>();
    for (let tick = 0; tick < SPRITE_FRAMES.count; tick++) {
      const walking: DuckState = {
        ...standing,
        mode: DUCK_MODES.running,
        moving: true,
        runClockMs: tick * CONFIG.runFrameMs,
      };
      frames.add(spriteFrame(walking, CONFIG));
    }
    expect(frames.size).toBe(SPRITE_FRAMES.count);
  });
});
