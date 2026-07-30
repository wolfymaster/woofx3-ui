import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

// EngineInfo is "stable for the lifetime of a deployment" (see convex/engineInfo.ts),
// so a per-instance in-memory cache avoids re-fetching it every time the editor mounts
// (e.g. switching between scenes, which remounts SceneCanvasEditor via its `key` prop).
const overlayBaseUrlCache = new Map<string, Promise<string | null>>();

function fetchOverlayBaseUrl(
  instanceId: Id<"instances">,
  getEngineInfo: (args: { instanceId: Id<"instances"> }) => Promise<{ engineSceneOverlayBaseUrl: string } | null>
): Promise<string | null> {
  const cached = overlayBaseUrlCache.get(instanceId);
  if (cached) {
    return cached;
  }
  const promise = getEngineInfo({ instanceId }).then((info) => info?.engineSceneOverlayBaseUrl || null);
  overlayBaseUrlCache.set(instanceId, promise);
  return promise;
}

interface LiveScenePreviewProps {
  instanceId: Id<"instances">;
  engineSceneId: string;
  width: number;
  height: number;
}

/**
 * Embeds the engine's real overlay for this scene — the same URL the OBS browser
 * source iframes (see convex/http.ts's /browser-source/{key} route and
 * convex/lib/browserSourceHtml.ts) — so the canvas shows a pixel-accurate,
 * live-reactive preview instead of a reimplementation of widget rendering.
 * Reflects the last-saved scene state; unsaved edits only appear after Save
 * (see docs/ui/scenes.md).
 */
export function LiveScenePreview({ instanceId, engineSceneId, width, height }: LiveScenePreviewProps) {
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  // undefined = loading; null = no overlay configured for this engine.
  const [overlayBaseUrl, setOverlayBaseUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setOverlayBaseUrl(undefined);
    fetchOverlayBaseUrl(instanceId, getEngineInfo).then((url) => {
      if (!cancelled) {
        setOverlayBaseUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [instanceId, getEngineInfo]);

  if (!overlayBaseUrl) {
    return (
      <div
        className="absolute inset-0 z-[1] flex items-center justify-center bg-black/40 text-center text-xs text-white/50"
        style={{ width, height }}
      >
        {overlayBaseUrl === null ? "Overlay rendering is not configured for this engine." : "Loading preview…"}
      </div>
    );
  }

  const src = `${overlayBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(engineSceneId)}`;

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
      key={src}
      src={src}
      title="Scene preview"
      sandbox="allow-scripts allow-same-origin"
      scrolling="no"
      className="absolute inset-0 z-[1] border-none bg-transparent pointer-events-none"
      style={{ width, height }}
      data-testid="live-scene-preview"
    />
  );
}
