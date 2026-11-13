/**
 * The wait room's duck game, as plain state so its physics can be tested
 * without a browser. World units are pixels at scale 1, y grows upwards from
 * the ground, and the duck auto-runs to the right. The component only draws
 * this state and feeds it a fixed timestep.
 */

/** A platform in the course. `x` is its left edge, `height` its top above the ground. */
export interface DuckHopBar {
  x: number;
  width: number;
  height: number;
}

export type DuckHopPhase = "idle" | "running" | "paused" | "reset";

export type DuckHopEventKind = "start" | "hop" | "land" | "reset" | "lap" | "pause" | "resume";

export interface DuckHopEvent {
  kind: DuckHopEventKind;
  /** Increases with every event, so a consumer can tell repeats apart. */
  sequence: number;
  /** The lap an event happened on, for the lines that mention it. */
  lap: number;
}

export interface DuckHopState {
  phase: DuckHopPhase;
  bars: readonly DuckHopBar[];
  duckX: number;
  duckY: number;
  velocityY: number;
  grounded: boolean;
  cameraX: number;
  /** World units per second. */
  speed: number;
  lap: number;
  /** Bars the duck has landed past, across resets. */
  cleared: number;
  /** The last bar the duck landed on, or -1 before any; scoring counts bars passed since. */
  standingOn: number;
  sinceResetMs: number;
  event: DuckHopEvent | null;
  sequence: number;
}

/** Where the duck sits on screen; the camera keeps it there as the course scrolls. */
export const DUCK_SCREEN_X = 140;
export const STEP_MS = 1_000 / 60;
export const BASE_SPEED = 240;
export const SPEED_STEP = 0.12;
/** Laps keep making the course faster until this, then stay there so the game stays playable. */
export const MAX_SPEED_FACTOR = 1.6;
export const GRAVITY = 2_000;
export const JUMP_VELOCITY = 600;
export const RESET_PAUSE_MS = 900;

const BAR_WIDTH = 220;
const FIRST_BAR_WIDTH = 340;
const BAR_GAP = 70;
const START_OFFSET = 70;
const COURSE_HEIGHTS = [20, 40, 30, 50, 35, 60, 45, 30] as const;

function cameraFor(duckX: number): number {
  return Math.max(0, duckX - DUCK_SCREEN_X);
}

function eventFor(
  state: Pick<DuckHopState, "sequence" | "lap">,
  kind: DuckHopEventKind
): {
  event: DuckHopEvent;
  sequence: number;
} {
  const sequence = state.sequence + 1;
  return { event: { kind, sequence, lap: state.lap }, sequence };
}

/** The course for one lap. Heights climb and dip so a hop is always needed but always possible. */
export function createCourse(): DuckHopBar[] {
  let x = 0;
  return COURSE_HEIGHTS.map((height, index) => {
    const width = index === 0 ? FIRST_BAR_WIDTH : BAR_WIDTH;
    const bar = { x, width, height };
    x += width + BAR_GAP;
    return bar;
  });
}

export function createDuckHop(): DuckHopState {
  const bars = createCourse();
  const first = bars[0];
  const duckX = first.x + START_OFFSET;
  return {
    phase: "idle",
    bars,
    duckX,
    duckY: first.height,
    velocityY: 0,
    grounded: true,
    cameraX: cameraFor(duckX),
    speed: BASE_SPEED,
    lap: 1,
    cleared: 0,
    standingOn: 0,
    sinceResetMs: 0,
    event: null,
    sequence: 0,
  };
}

/**
 * Space. The first press starts the run with a hop; later presses only work
 * from the top of a bar, because a second hop in the air would let the duck
 * fly over the course.
 */
export function hop(state: DuckHopState): DuckHopState {
  if (state.phase === "paused" || state.phase === "reset") {
    return state;
  }
  if (state.phase === "idle") {
    return {
      ...state,
      phase: "running",
      velocityY: JUMP_VELOCITY,
      grounded: false,
      ...eventFor(state, "start"),
    };
  }
  if (!state.grounded) {
    return state;
  }
  return {
    ...state,
    velocityY: JUMP_VELOCITY,
    grounded: false,
    ...eventFor(state, "hop"),
  };
}

export function pauseGame(state: DuckHopState): DuckHopState {
  if (state.phase !== "running") {
    return state;
  }
  return { ...state, phase: "paused", ...eventFor(state, "pause") };
}

export function resumeGame(state: DuckHopState): DuckHopState {
  if (state.phase !== "paused") {
    return state;
  }
  return { ...state, phase: "running", ...eventFor(state, "resume") };
}

function beginReset(state: DuckHopState, x: number, y: number, velocityY: number): DuckHopState {
  return {
    ...state,
    phase: "reset",
    duckX: x,
    duckY: Math.max(0, y),
    velocityY,
    grounded: false,
    standingOn: -1,
    cameraX: cameraFor(x),
    sinceResetMs: 0,
    ...eventFor(state, "reset"),
  };
}

function restart(state: DuckHopState): DuckHopState {
  const first = state.bars[0];
  const duckX = first.x + START_OFFSET;
  return {
    ...state,
    phase: "running",
    duckX,
    duckY: first.height,
    velocityY: 0,
    grounded: true,
    standingOn: 0,
    cameraX: cameraFor(duckX),
    sinceResetMs: 0,
  };
}

function startNextLap(state: DuckHopState): DuckHopState {
  const first = state.bars[0];
  const duckX = first.x + START_OFFSET;
  const lap = state.lap + 1;
  return {
    ...state,
    phase: "running",
    duckX,
    duckY: first.height,
    velocityY: 0,
    grounded: true,
    standingOn: 0,
    cameraX: cameraFor(duckX),
    lap,
    speed: BASE_SPEED * Math.min(MAX_SPEED_FACTOR, 1 + SPEED_STEP * (lap - 1)),
    ...eventFor({ ...state, lap }, "lap"),
  };
}

/** One fixed step. Idle, paused and the reset beat hold still; everything else advances. */
export function stepGame(state: DuckHopState, dtMs: number): DuckHopState {
  if (state.phase === "idle" || state.phase === "paused") {
    return state;
  }
  if (state.phase === "reset") {
    const sinceResetMs = state.sinceResetMs + dtMs;
    if (sinceResetMs < RESET_PAUSE_MS) {
      return { ...state, sinceResetMs };
    }
    return restart(state);
  }

  const dt = dtMs / 1_000;
  const previousY = state.duckY;
  const x = state.duckX + state.speed * dt;
  let y = previousY;
  let velocityY = state.velocityY;
  let grounded = state.grounded;
  let standingOn = state.standingOn;
  let cleared = state.cleared;

  if (!grounded) {
    velocityY -= GRAVITY * dt;
    y += velocityY * dt;
  }

  const last = state.bars[state.bars.length - 1];
  if (x >= last.x + last.width) {
    return startNextLap({ ...state, cleared });
  }

  const index = state.bars.findIndex((bar) => x >= bar.x && x <= bar.x + bar.width);
  if (index >= 0) {
    const bar = state.bars[index];
    const landed = !grounded && velocityY <= 0 && previousY >= bar.height && y <= bar.height;
    if (landed) {
      y = bar.height;
      velocityY = 0;
      grounded = true;
      if (index > standingOn) {
        cleared += index - standingOn;
      }
      standingOn = index;
      return {
        ...state,
        duckX: x,
        duckY: y,
        velocityY,
        grounded,
        standingOn,
        cleared,
        cameraX: cameraFor(x),
        ...eventFor(state, "land"),
      };
    }
    if (!grounded && y < bar.height) {
      return beginReset({ ...state, cleared }, x, y, velocityY);
    }
    if (grounded) {
      y = bar.height;
      if (index > standingOn) {
        cleared += index - standingOn;
      }
      standingOn = index;
    }
  } else if (grounded) {
    grounded = false;
    velocityY = 0;
  }

  if (!grounded && y <= 0) {
    return beginReset({ ...state, cleared }, x, y, velocityY);
  }

  return {
    ...state,
    duckX: x,
    duckY: y,
    velocityY,
    grounded,
    standingOn,
    cleared,
    cameraX: cameraFor(x),
  };
}

export const CHAT_LINES: Record<DuckHopEventKind, readonly string[]> = {
  start: ["here before the dashboard", "LETS GO"],
  hop: ["hop", "HOP", "boing"],
  land: ["clean", "nice", "GG"],
  reset: ["F", "duck diff", "back to the first bar"],
  lap: ["LAP {lap}", "he's speedrunning the wait", "GG"],
  pause: ["brb", "paused?!"],
  resume: ["welcome back", "LETS GO"],
};

export const CHAT_AUTHORS = ["pixelpup", "moss", "tinyhat", "jpg", "sable", "nori", "kilo", "bug"] as const;

export interface DuckHopChatLine {
  sequence: number;
  author: string;
  text: string;
}

function lineFor(event: DuckHopEvent): string {
  return event.kind === "lap" ? `LAP ${event.lap}` : "";
}

/** A line that has not been on screen recently; the last line is reused only when the pool is spent. */
export function pickChatLine(event: DuckHopEvent, recent: readonly string[], random = Math.random): string {
  const pool = CHAT_LINES[event.kind].map((line) => (line.includes("{lap}") ? lineFor(event) : line));
  const fresh = pool.filter((line) => !recent.includes(line));
  const last = recent[recent.length - 1];
  const fallback = pool.filter((line) => line !== last);
  const candidates = fresh.length > 0 ? fresh : fallback.length > 0 ? fallback : pool;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index];
}

/** Chat is a decoration with a short memory: eight lines is all the column shows. */
export function appendChatLine(
  lines: readonly DuckHopChatLine[],
  text: string,
  sequence: number,
  max = 8
): DuckHopChatLine[] {
  const line = { sequence, author: CHAT_AUTHORS[sequence % CHAT_AUTHORS.length], text };
  return [...lines, line].slice(-max);
}

/** Implemented as an interface so a test can pass a plain object. */
export interface ScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DUCK_HOP_BEST_KEY = "woofx3.duck-hop.best";

export function readBestScore(storage: Pick<ScoreStorage, "getItem"> | null | undefined): number {
  try {
    const raw = storage?.getItem(DUCK_HOP_BEST_KEY);
    if (raw === null || raw === undefined) {
      return 0;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    // Storage can be blocked in a sandboxed frame; a lost best score is not worth an error.
    return 0;
  }
}

export function writeBestScore(storage: ScoreStorage | null | undefined, score: number): void {
  try {
    storage?.setItem(DUCK_HOP_BEST_KEY, String(Math.max(0, Math.floor(score))));
  } catch {
    // Storage can be full or blocked; the game still works without remembering.
  }
}
