import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

interface LiveScenePreviewProps {
  sceneId: Id<"scenes"> | undefined;
  width: number;
  height: number;
}

/**
 * Embeds the engine's real overlay for this scene — the same engine-minted
 * overlay-token URL the OBS browser source iframes (see
 * convex/browserSource.ts's getOrCreatePreviewUrl and convex/http.ts's
 * /browser-source/{key} route) — so the canvas shows a pixel-accurate,
 * live-reactive preview instead of a reimplementation of widget rendering.
 * Uses its own "preview"-purpose token, kept separate from the OBS-facing
 * one so rotating/revoking either never disturbs the other.
 * Reflects the last-saved scene state; unsaved edits only appear after Save
 * (see docs/ui/scenes.md).
 */
export function LiveScenePreview({ sceneId, width, height }: LiveScenePreviewProps) {
  const getOrCreatePreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  // undefined = loading; null = not ready yet (scene not synced, or mint failed).
  const [overlayUrl, setOverlayUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!sceneId) {
      setOverlayUrl(undefined);
      return;
    }
    let cancelled = false;
    setOverlayUrl(undefined);
    getOrCreatePreviewUrl({ sceneId }).then((url) => {
      if (!cancelled) {
        setOverlayUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, getOrCreatePreviewUrl]);

  if (!overlayUrl) {
    return (
      <div
        className="absolute inset-0 z-[1] flex items-center justify-center bg-black/40 text-center text-xs text-white/50"
        style={{ width, height }}
      >
        {overlayUrl === null ? "Preview isn't ready yet." : "Loading preview…"}
      </div>
    );
  }

  return (
    // See convex/lib/browserSourceHtml.ts for why allow-same-origin is required
    // alongside allow-scripts: the overlay nests widget iframes and needs its own
    // origin preserved to inject widgetHost into them.
    //
    // pointer-events-none is required: a cross-origin iframe swallows mousemove
    // once the cursor enters it, which would otherwise break the window-level
    // drag tracking CanvasWidgetHandle relies on for positioning widgets. This is
    // a preview surface only — nothing in it needs to be directly interactive.
    <iframe
      key={overlayUrl}
      src={overlayUrl}
      title="Scene preview"
      sandbox="allow-scripts allow-same-origin"
      scrolling="no"
      className="absolute inset-0 z-[1] border-none bg-transparent pointer-events-none"
      style={{ width, height }}
      data-testid="live-scene-preview"
    />
  );
}
