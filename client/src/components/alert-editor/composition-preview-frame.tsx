import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { CompositionPreviewController, PreviewFrameBinding } from "@/hooks/use-composition-preview";
import { formatPlayhead } from "@/lib/composition-preview";
import { cn } from "@/lib/utils";

/**
 * sceneManager's composition preview page, behind the stage's layers at the
 * stage's on-screen size: the page fits the alert's canvas into its frame,
 * so it draws at the stage's zoom exactly where the stand-ins draw.
 *
 * The URL is framed directly rather than through a convex.site page, which
 * would make every request to sceneManager cross-site and drop its
 * SameSite=Strict session cookie (see convex/compositionPreview.ts).
 */
export function CompositionPreviewFrame({
  frame,
  width,
  height,
  visible,
}: {
  frame: PreviewFrameBinding;
  width: number;
  height: number;
  /** Hidden, not unmounted, until the page plays the document, so it loads behind the stand-ins. */
  visible: boolean;
}) {
  return (
    // allow-same-origin alongside allow-scripts: the page nests one frame per widget and
    // reaches them through its own origin, which is the engine's, never this page's.
    //
    // pointer-events-none: the stage's layers above take every press; nothing in the
    // page is interactive.
    <iframe
      ref={frame.ref}
      src={frame.src}
      onLoad={frame.onLoad}
      title="Alert preview"
      sandbox="allow-scripts allow-same-origin"
      // An engine hostname resolving to a LAN address is otherwise auto-denied by
      // Chrome's Local Network Access check (see live-scene-preview.tsx).
      allow="local-network-access autoplay"
      scrolling="no"
      className={cn(
        "pointer-events-none absolute left-0 top-0 border-none bg-transparent",
        visible ? "opacity-100" : "opacity-0"
      )}
      // The page declares no color-scheme; matching it keeps its transparent pixels transparent under a dark theme.
      style={{ width, height, colorScheme: "light" }}
      data-testid="alert-preview-frame"
    />
  );
}

/**
 * Play, restart and a scrub over the page's timeline, sized for the canvas
 * readout it replaces. The page owns the playhead; the editor's timeline
 * follows its reports, which is what the scrub shows.
 */
export function PreviewTransport({
  preview,
  playheadMs,
  playing,
  scrub = true,
  className,
}: {
  preview: CompositionPreviewController;
  playheadMs: number;
  playing: boolean;
  /** Without it, only the buttons and time: for a row too narrow for a slider. */
  scrub?: boolean;
  className?: string;
}) {
  const durationMs = preview.durationMs ?? 0;
  return (
    <div className={cn("flex items-center gap-1", className)} data-testid="alert-preview-transport">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label={playing ? "Pause preview" : "Play preview"}
        onClick={playing ? preview.pause : preview.play}
        data-testid="button-preview-play"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label="Restart preview"
        onClick={preview.restart}
        data-testid="button-preview-restart"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      {scrub && <PreviewScrub preview={preview} playheadMs={playheadMs} className="w-28" />}
      <span className="tabular-nums">
        {formatPlayhead(playheadMs)} / {formatPlayhead(durationMs)}
      </span>
    </div>
  );
}

export function PreviewScrub({
  preview,
  playheadMs,
  className,
}: {
  preview: CompositionPreviewController;
  playheadMs: number;
  className?: string;
}) {
  const durationMs = preview.durationMs ?? 0;
  return (
    <Slider
      className={className}
      min={0}
      max={Math.max(1, durationMs)}
      step={10}
      value={[Math.min(playheadMs, Math.max(1, durationMs))]}
      onValueChange={([ms]) => preview.seek(ms)}
      disabled={durationMs === 0}
      aria-label="Preview playhead"
      data-testid="slider-preview-playhead"
    />
  );
}
