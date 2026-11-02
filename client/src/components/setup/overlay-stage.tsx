import { DEFAULT_ALERT_WIDGET_BOX, DEFAULT_OVERLAY_CANVAS } from "@shared/default-seed";
import { cn } from "@/lib/utils";

type StageMood = "dark" | "ready" | "playing" | "celebrating";

const CONFETTI = Array.from({ length: 14 }, (_, index) => ({
  key: index,
  left: `${(index * 37 + 8) % 96}%`,
  delayMs: (index * 113) % 700,
  primary: index % 2 === 0,
}));

function percentOf(value: number, whole: number): string {
  return `${(value / whole) * 100}%`;
}

/**
 * A little picture of the stream, with the corner the default alert plays in
 * where it really is on the canvas, so "watch the top right" needs no
 * explaining. It repeats what the page says in words, so it is hidden from
 * assistive technology.
 */
export function OverlayStage({ mood }: { mood: StageMood }) {
  const { x, y, width, height } = DEFAULT_ALERT_WIDGET_BOX;
  const { width: canvasWidth, height: canvasHeight } = DEFAULT_OVERLAY_CANVAS;
  return (
    <div
      aria-hidden="true"
      className="relative aspect-video w-full overflow-hidden rounded-xl border-4 border-neutral-800 bg-neutral-950 shadow-2xl"
      data-testid="overlay-stage"
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-700",
          mood === "dark" ? "opacity-20" : "opacity-100",
          "bg-[radial-gradient(ellipse_at_30%_70%,hsl(var(--primary)/0.35),transparent_60%)]"
        )}
      />
      <div
        className={cn(
          "absolute flex items-center justify-center rounded-lg border-2 text-center transition-colors duration-500",
          mood === "dark" ? "border-dashed border-neutral-700" : "border-primary"
        )}
        style={{
          left: percentOf(x, canvasWidth),
          top: percentOf(y, canvasHeight),
          width: percentOf(width, canvasWidth),
          height: percentOf(height, canvasHeight),
        }}
      >
        {mood === "dark" && <span className="px-2 text-xs text-neutral-500">Your alerts appear here</span>}
        {mood === "ready" && <span className="px-2 text-xs text-primary">Ready for alerts</span>}
        {(mood === "playing" || mood === "celebrating") && (
          <span className="rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300 sm:text-sm">
            New follower!
          </span>
        )}
      </div>
      {mood === "celebrating" &&
        CONFETTI.map((piece) => (
          <span
            key={piece.key}
            className={cn(
              "absolute top-0 hidden h-2 w-2 rounded-sm motion-safe:block motion-safe:animate-confetti-fall",
              piece.primary ? "bg-primary" : "bg-neutral-100"
            )}
            style={{ left: piece.left, animationDelay: `${piece.delayMs}ms` }}
          />
        ))}
    </div>
  );
}
