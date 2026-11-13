import { describe, expect, test } from "bun:test";
import {
  appendChatLine,
  BASE_SPEED,
  CHAT_AUTHORS,
  createDuckHop,
  DUCK_HOP_BEST_KEY,
  type DuckHopEvent,
  type DuckHopEventKind,
  type DuckHopState,
  hop,
  MAX_SPEED_FACTOR,
  pauseGame,
  pickChatLine,
  RESET_PAUSE_MS,
  readBestScore,
  resumeGame,
  SPEED_STEP,
  stepGame,
  writeBestScore,
} from "@/lib/duck-hop";

const BARS = [
  { x: 0, width: 200, height: 40 },
  { x: 300, width: 200, height: 80 },
];

function running(overrides: Partial<DuckHopState> = {}): DuckHopState {
  return {
    ...createDuckHop(),
    bars: BARS,
    phase: "running",
    duckX: 290,
    duckY: 100,
    velocityY: 0,
    grounded: false,
    standingOn: 0,
    ...overrides,
  };
}

function gameEvent(kind: DuckHopEventKind, lap = 1): DuckHopEvent {
  return { kind, sequence: 1, lap };
}

describe("duck hop physics", () => {
  test("starts idle on the first bar until the first hop", () => {
    const state = createDuckHop();
    expect(state.phase).toBe("idle");
    expect(state.grounded).toBe(true);
    expect(state.standingOn).toBe(0);
    expect(stepGame(state, 100)).toBe(state);

    const started = hop(state);
    expect(started.phase).toBe("running");
    expect(started.grounded).toBe(false);
    expect(started.event?.kind).toBe("start");
  });

  test("lands on a bar top and counts the bars it passed", () => {
    const next = stepGame(running(), 100);

    expect(next.grounded).toBe(true);
    expect(next.duckY).toBe(80);
    expect(next.standingOn).toBe(1);
    expect(next.cleared).toBe(1);
    expect(next.event?.kind).toBe("land");
  });

  test("a hop from the top of a bar does not count that bar again", () => {
    const onFirst = running({ duckX: 100, duckY: 40, grounded: true, velocityY: 0, standingOn: 0 });
    const airborne = hop(onFirst);
    const landed = stepGame({ ...airborne, velocityY: -1, duckY: 41, duckX: 100 }, 50);

    expect(landed.grounded).toBe(true);
    expect(landed.cleared).toBe(0);
  });

  test("hitting the side of a taller bar sends the duck back to the first bar", () => {
    const next = stepGame(running({ duckY: 60, velocityY: 0 }), 100);

    expect(next.phase).toBe("reset");
    expect(next.event?.kind).toBe("reset");
    expect(next.cleared).toBe(0);
  });

  test("falls reset at the ground", () => {
    const next = stepGame(running({ duckX: 250, duckY: 1, velocityY: -100 }), 20);

    expect(next.phase).toBe("reset");
    expect(next.duckY).toBe(0);
    expect(next.event?.kind).toBe("reset");
  });

  test("runs off the end of a bar into the gap", () => {
    const next = stepGame(running({ duckX: 195, duckY: 40, grounded: true, velocityY: 0 }), 50);

    expect(next.grounded).toBe(false);
    expect(next.duckY).toBe(40);
  });

  test("restarts on the first bar once the reset beat is over, keeping score and lap", () => {
    const waiting = running({
      phase: "reset",
      sinceResetMs: RESET_PAUSE_MS - 1,
      duckX: 350,
      duckY: 20,
      cleared: 4,
      lap: 2,
    });
    const restarted = stepGame(waiting, 10);

    expect(restarted.phase).toBe("running");
    expect(restarted.duckX).toBe(70);
    expect(restarted.duckY).toBe(40);
    expect(restarted.grounded).toBe(true);
    expect(restarted.cleared).toBe(4);
    expect(restarted.lap).toBe(2);
  });

  test("loops to the first bar and speeds up after the last bar", () => {
    const next = stepGame(running({ duckX: 495, duckY: 80, grounded: true, velocityY: 0 }), 50);

    expect(next.lap).toBe(2);
    expect(next.speed).toBeCloseTo(BASE_SPEED * (1 + SPEED_STEP));
    expect(next.duckX).toBe(70);
    expect(next.duckY).toBe(40);
    expect(next.standingOn).toBe(0);
    expect(next.event?.kind).toBe("lap");
    expect(next.event?.lap).toBe(2);
  });

  test("stops speeding up once the course is fast enough", () => {
    let state = running({ duckX: 495, duckY: 80, grounded: true, velocityY: 0, lap: 20 });
    state = stepGame(state, 50);

    expect(state.speed).toBeCloseTo(BASE_SPEED * MAX_SPEED_FACTOR);
  });

  test("cannot hop twice in one jump", () => {
    const airborne = running({ duckY: 200 });
    expect(hop(airborne)).toBe(airborne);
  });

  test("pause holds still and resume continues", () => {
    const paused = pauseGame(running());
    expect(paused.phase).toBe("paused");
    expect(paused.event?.kind).toBe("pause");
    expect(stepGame(paused, 100)?.phase).toBe("paused");
    expect(resumeGame(paused).phase).toBe("running");
  });
});

describe("fake chat", () => {
  test("picks a line not already on screen", () => {
    const event = gameEvent("hop");
    const first = pickChatLine(event, [], () => 0);
    const second = pickChatLine(event, [first], () => 0);
    const third = pickChatLine(event, [first, second], () => 0);

    expect(second).not.toBe(first);
    expect(third).not.toBe(first);
    expect(third).not.toBe(second);
  });

  test("names the lap in its lap line", () => {
    expect(pickChatLine(gameEvent("lap", 3), [], () => 0)).toBe("LAP 3");
  });

  test("keeps the last eight lines and cycles authors", () => {
    let lines: ReturnType<typeof appendChatLine> = [];
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      lines = appendChatLine(lines, `line ${sequence}`, sequence);
    }

    expect(lines).toHaveLength(8);
    expect(lines[0].text).toBe("line 3");
    expect(lines[7].text).toBe("line 10");
    expect(lines[0].author).toBe(CHAT_AUTHORS[3 % CHAT_AUTHORS.length]);
  });
});

describe("best score", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  test("reads only a usable stored score", () => {
    expect(readBestScore(fakeStorage())).toBe(0);
    expect(readBestScore(fakeStorage({ [DUCK_HOP_BEST_KEY]: "12" }))).toBe(12);
    expect(readBestScore(fakeStorage({ [DUCK_HOP_BEST_KEY]: "nonsense" }))).toBe(0);
    expect(readBestScore(null)).toBe(0);
  });

  test("writes whole bars", () => {
    const storage = fakeStorage();
    writeBestScore(storage, 12.9);
    expect(storage.values.get(DUCK_HOP_BEST_KEY)).toBe("12");
  });

  test("a blocked storage neither reads nor writes", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readBestScore(blocked)).toBe(0);
    expect(() => writeBestScore(blocked, 4)).not.toThrow();
  });
});
