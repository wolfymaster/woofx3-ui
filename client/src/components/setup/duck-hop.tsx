import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createDuckHop,
  type DuckHopEvent,
  type DuckHopState,
  hop,
  pauseGame,
  readBestScore,
  resumeGame,
  STEP_MS,
  stepGame,
  writeBestScore,
} from "@/lib/duck-hop";
import { cn } from "@/lib/utils";

interface DuckHopProps {
  /** False once the engine is ready, so the game freezes rather than carrying on behind the ready card. */
  enabled: boolean;
  onEvent?: (event: DuckHopEvent) => void;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, input, textarea, select, summary, [contenteditable='true'], [role='button']") !== null
  );
}

function statusOf(state: DuckHopState): string {
  switch (state.phase) {
    case "idle":
      return "Press Space to hop";
    case "paused":
      return "Paused";
    case "reset":
      return "Back to the first bar";
    default:
      return state.grounded ? "Keep hopping" : "In the air";
  }
}

function announcementOf(state: DuckHopState): string {
  if (state.event?.kind === "reset") {
    return "Back to the first bar.";
  }
  if (state.event?.kind === "lap") {
    return `Lap ${state.lap}. It is faster now.`;
  }
  return "";
}

/**
 * The wait room's one-button game: an ASCII duck runs along the course that
 * used to be the level meter, and Space hops it from bar to bar. The scene is
 * decorative and hidden from assistive technology; the score and the short
 * announcements carry what matters, and the game can be skipped entirely.
 */
export function DuckHop({ enabled, onEvent }: DuckHopProps) {
  const [state, setState] = useState<DuckHopState>(createDuckHop);
  const [best, setBest] = useState(() => readBestScore(storage()));
  const stateRef = useRef(state);
  const onEventRef = useRef(onEvent);
  const emitted = useRef(0);
  const autoPaused = useRef(false);
  onEventRef.current = onEvent;

  const publish = useCallback((next: DuckHopState) => {
    stateRef.current = next;
    setState(next);
    const event = next.event;
    if (event !== null && event.sequence > emitted.current) {
      emitted.current = event.sequence;
      onEventRef.current?.(event);
    }
  }, []);

  const jump = useCallback(() => {
    if (!enabled) {
      return;
    }
    publish(hop(stateRef.current));
  }, [enabled, publish]);

  const togglePause = useCallback(() => {
    const current = stateRef.current;
    publish(current.phase === "paused" ? resumeGame(current) : pauseGame(current));
  }, [publish]);

  const active = enabled && (state.phase === "running" || state.phase === "reset");

  useEffect(() => {
    if (!active || typeof requestAnimationFrame !== "function") {
      return;
    }
    let frame = 0;
    let last = performance.now();
    let accumulator = 0;
    const tick = (now: number) => {
      accumulator += Math.min(now - last, 250);
      last = now;
      let current = stateRef.current;
      let changed = false;
      while (accumulator >= STEP_MS) {
        accumulator -= STEP_MS;
        const next = stepGame(current, STEP_MS);
        if (next === current) {
          accumulator = 0;
          break;
        }
        current = next;
        changed = true;
      }
      if (changed) {
        publish(current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, publish]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isInteractive(event.target)) {
        return;
      }
      event.preventDefault();
      jump();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, jump]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const paused = pauseGame(stateRef.current);
        autoPaused.current = paused !== stateRef.current;
        publish(paused);
        return;
      }
      if (autoPaused.current) {
        autoPaused.current = false;
        publish(resumeGame(stateRef.current));
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled, publish]);

  useEffect(() => {
    if (state.cleared <= best) {
      return;
    }
    setBest(state.cleared);
    writeBestScore(storage(), state.cleared);
  }, [state.cleared, best]);

  const status = statusOf(state);
  const paused = state.phase === "paused";

  return (
    <div className="space-y-2" data-testid="duck-hop">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-neutral-400">
        <span data-testid="duck-hop-status">{status}</span>
        <span className="font-system-mono" data-testid="duck-hop-score">
          Bars {state.cleared} · Lap {state.lap} · Best {best}
        </span>
      </div>

      <div
        className="relative h-44 cursor-pointer overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
        aria-hidden="true"
        data-testid="duck-hop-scene"
        onPointerDown={(event) => {
          event.preventDefault();
          jump();
        }}
      >
        {state.bars.map((bar) => (
          <span
            key={bar.x}
            className="absolute rounded-t-sm border-t border-primary/60 bg-primary/25"
            style={{
              left: bar.x - state.cameraX,
              width: bar.width,
              height: bar.height,
              bottom: 0,
            }}
          />
        ))}
        <span
          className="absolute font-mono text-lg leading-none text-primary"
          style={{ left: state.duckX - state.cameraX - 14, bottom: state.duckY + 2 }}
        >
          (o&gt;~
        </span>
        <span className="absolute inset-x-0 bottom-0 h-px bg-neutral-700" />
      </div>

      <p className="sr-only" aria-live="polite" data-testid="duck-hop-announcement">
        {announcementOf(state)}
      </p>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={jump} aria-keyshortcuts="Space" data-testid="button-duck-hop">
          Hop
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "border-neutral-700 bg-transparent text-neutral-200 hover:bg-neutral-800 hover:text-neutral-50",
            state.phase !== "running" && state.phase !== "paused" && "invisible"
          )}
          onClick={togglePause}
          disabled={state.phase !== "running" && state.phase !== "paused"}
          data-testid="button-duck-hop-pause"
        >
          {paused ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </div>
  );
}
