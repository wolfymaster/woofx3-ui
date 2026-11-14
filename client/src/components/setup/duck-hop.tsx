import { type ReactNode, useEffect, useRef, useState } from "react";
import duckSprite from "@/assets/duck-hop-sprite.png";
import {
  askHop,
  type Course,
  createGame,
  DEFAULT_DUCK_HOP_CONFIG,
  DUCK_EVENTS,
  DUCK_MODES,
  type DuckInput,
  type DuckState,
  SPRITE_FRAMES,
  type Surface,
  spriteFrame,
  stepGame,
  wake,
} from "@/lib/duck-hop";

const CONFIG = DEFAULT_DUCK_HOP_CONFIG;
const DUCK_HEIGHT_PX = 64;
const MAX_PIXEL_RATIO = 3;
/** A long gap between frames (a stalled tab) must not become one huge step. */
const MAX_STEP_SECONDS = 0.05;
const DOWN_BLINK_MS = 70;
const DOWN_BLINK_OPACITY = 0.2;
const BEST_KEY = "woofx3.duck-hop.best";

const NOTICES = { hint: "hint", playing: "playing", down: "down", lap: "lap", paused: "paused" } as const;
type Notice = (typeof NOTICES)[keyof typeof NOTICES];

function noticeText(notice: Notice, lap: number): string {
  switch (notice) {
    case NOTICES.hint:
      return "Arrow keys to move, Space to hop";
    case NOTICES.down:
      return "Back to the first bar";
    case NOTICES.lap:
      return `Lap ${lap}`;
    case NOTICES.paused:
      return "Paused";
    case NOTICES.playing:
      return "";
  }
}

interface Score {
  bars: number;
  best: number;
  lap: number;
}

const DIRECTION_OF_KEY = new Map<string, keyof DuckInput>([
  ["ArrowLeft", "left"],
  ["ArrowRight", "right"],
]);

// The best score is a nicety, so a browser that blocks storage just forgets it.
function readBest(): number {
  try {
    const stored = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
  } catch {
    return 0;
  }
}

function writeBest(best: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // Blocked storage only costs the remembered best score.
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [role=button]") !== null;
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable]") !== null;
}

function measureCourse(layer: HTMLElement, bars: readonly HTMLElement[]): Course {
  const origin = layer.getBoundingClientRect().left;
  const rects = bars.map((bar) => bar.getBoundingClientRect());
  return {
    left: rects.map((rect) => rect.left - origin),
    right: rects.map((rect) => rect.right - origin),
    fixedHeight: bars.map((bar) => bar.offsetHeight),
  };
}

/** The bars as they are drawn this instant, pulse included, so the duck stands on what is on screen. */
function liveSurface(layer: HTMLElement, bars: readonly HTMLElement[]): Surface {
  const bottom = layer.getBoundingClientRect().bottom;
  return {
    floor: bottom - bars[0].getBoundingClientRect().bottom,
    top: (bar) => bottom - bars[bar].getBoundingClientRect().top,
  };
}

interface DuckHopProps {
  /** The game runs only while this is true; the wrapped meter is untouched either way. */
  enabled: boolean;
  /** The level meter: one element whose children are the bars the duck walks on. */
  children: ReactNode;
}

/**
 * A one-key game on the finish page's level meter. The duck walks along the
 * bars with the arrow keys and hops with Space (or a click on the bars); a bar
 * far taller than the last is a wall. It never gates the dashboard and stops
 * when the wait ends.
 */
export function DuckHop({ enabled, children }: DuckHopProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [notice, setNotice] = useState<Notice>(NOTICES.hint);
  const [score, setScore] = useState<Score>({ bars: 0, best: 0, lap: 1 });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const wrapper = wrapperRef.current;
    const layer = layerRef.current;
    const canvas = canvasRef.current;
    const meter = wrapper?.firstElementChild;
    const context = canvas?.getContext("2d");
    if (!wrapper || !layer || !canvas || !meter || !context) {
      return;
    }
    const bars = Array.from(meter.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    if (bars.length === 0) {
      return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.height = Math.round(DUCK_HEIGHT_PX * pixelRatio);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const sprite = new Image();
    let spriteReady = false;
    let duckWidthPx = DUCK_HEIGHT_PX;
    let drawnFrame = -1;
    sprite.onload = () => {
      const cellWidth = sprite.naturalWidth / SPRITE_FRAMES.count;
      duckWidthPx = (DUCK_HEIGHT_PX * cellWidth) / sprite.naturalHeight;
      canvas.width = Math.round(duckWidthPx * pixelRatio);
      canvas.style.width = `${duckWidthPx}px`;
      canvas.style.height = `${DUCK_HEIGHT_PX}px`;
      spriteReady = true;
      drawnFrame = -1;
    };
    sprite.src = duckSprite;

    let course = measureCourse(layer, bars);
    let game: DuckState = createGame(course, liveSurface(layer, bars), CONFIG);
    const held: DuckInput = { left: false, right: false };
    let paused = false;
    let best = readBest();
    let shown: Score = { bars: 0, best, lap: 1 };
    setScore(shown);
    setNotice(NOTICES.hint);
    let lastMs = performance.now();
    let frameRequest = 0;

    const wakeUp = (nowMs: number) => {
      if (paused) {
        paused = false;
        lastMs = nowMs;
        setNotice(NOTICES.playing);
      }
      if (game.mode === DUCK_MODES.idle) {
        game = wake(game, nowMs, CONFIG);
        setNotice(NOTICES.playing);
      }
    };

    const pause = () => {
      held.left = false;
      held.right = false;
      if (game.mode !== DUCK_MODES.idle && !paused) {
        paused = true;
        setNotice(NOTICES.paused);
      }
    };

    const draw = (nowMs: number) => {
      const frame = spriteFrame(game, CONFIG);
      if (spriteReady && frame !== drawnFrame) {
        drawnFrame = frame;
        const cellWidth = sprite.naturalWidth / SPRITE_FRAMES.count;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          sprite,
          frame * cellWidth,
          0,
          cellWidth,
          sprite.naturalHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );
      }
      const blinkedOut = game.mode === DUCK_MODES.down && Math.floor(nowMs / DOWN_BLINK_MS) % 2 === 1;
      canvas.style.opacity = blinkedOut ? String(DOWN_BLINK_OPACITY) : "1";
      canvas.style.transform = `translate3d(${game.x - duckWidthPx / 2}px, ${-game.y}px, 0) scaleX(${game.facing})`;
    };

    const tick = (nowMs: number) => {
      const dt = Math.min(MAX_STEP_SECONDS, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      if (!paused) {
        const result = stepGame(game, held, course, liveSurface(layer, bars), dt, nowMs, CONFIG);
        game = result.state;
        for (const event of result.events) {
          if (event === DUCK_EVENTS.wall) {
            setNotice(NOTICES.down);
          } else if (event === DUCK_EVENTS.lap) {
            setNotice(NOTICES.lap);
          } else if (event === DUCK_EVENTS.restart) {
            setNotice(NOTICES.playing);
          }
        }
        if (game.bars > best) {
          best = game.bars;
          writeBest(best);
        }
        if (game.bars !== shown.bars || game.lap !== shown.lap || best !== shown.best) {
          shown = { bars: game.bars, best, lap: game.lap };
          setScore(shown);
        }
      }
      draw(nowMs);
      frameRequest = requestAnimationFrame(tick);
    };
    frameRequest = requestAnimationFrame(tick);

    const onKeyDown = (event: KeyboardEvent) => {
      const direction = DIRECTION_OF_KEY.get(event.code);
      if (direction !== undefined) {
        if (isTextField(event.target)) {
          return;
        }
        event.preventDefault();
        wakeUp(performance.now());
        held[direction] = true;
        return;
      }
      if (event.code !== "Space" || event.repeat || isInteractive(event.target)) {
        return;
      }
      event.preventDefault();
      const nowMs = performance.now();
      wakeUp(nowMs);
      game = askHop(game, nowMs);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const direction = DIRECTION_OF_KEY.get(event.code);
      if (direction !== undefined) {
        held[direction] = false;
      }
    };
    const onPointerDown = () => {
      const nowMs = performance.now();
      wakeUp(nowMs);
      game = askHop(game, nowMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        pause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisibility);
    wrapper.addEventListener("pointerdown", onPointerDown);
    const resizeObserver = new ResizeObserver(() => {
      course = measureCourse(layer, bars);
      if (game.mode === DUCK_MODES.idle) {
        game = createGame(course, liveSurface(layer, bars), CONFIG);
      }
    });
    resizeObserver.observe(layer);

    return () => {
      cancelAnimationFrame(frameRequest);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisibility);
      wrapper.removeEventListener("pointerdown", onPointerDown);
      resizeObserver.disconnect();
      sprite.onload = null;
    };
  }, [enabled]);

  return (
    <>
      {enabled && (
        <div className="flex flex-wrap gap-x-4 px-6 pb-2 text-sm text-neutral-500">
          <output aria-live="polite" className="text-neutral-400" data-testid="text-duck-status">
            {noticeText(notice, score.lap)}
          </output>
          <span className="tabular-nums" data-testid="text-duck-score">
            Bars {score.bars} · Best {score.best} · Lap {score.lap}
          </span>
        </div>
      )}
      <div ref={wrapperRef} className="relative">
        {children}
        {enabled && (
          <div
            ref={layerRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(100%+9.5rem)] overflow-hidden"
            aria-hidden="true"
          >
            <canvas ref={canvasRef} className="absolute bottom-0 left-0 will-change-transform" />
          </div>
        )}
      </div>
    </>
  );
}
