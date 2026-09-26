import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildPreviewLayoutMessage } from "@/lib/scene-preview-layout";
import type { Widget } from "@/types";

interface LiveScenePreviewProps {
  sceneId: Id<"scenes"> | undefined;
  width: number;
  height: number;
  /** The editor's current widgets, saved or not; the overlay is moved to match. */
  widgets: readonly Widget[];
}

/**
 * Embeds the engine's Scene Manager overlay directly —
 * `{Scene Manager Public URL}/scene/{engineSceneId}?token={token}`, minted by
 * convex/browserSource.ts's getOrCreatePreviewUrl — so the canvas shows the real
 * overlay rather than a reimplementation of widget rendering.
 *
 * Deliberately NOT routed through the /browser-source/{key} route OBS loads.
 * That route exists to give OBS a stable URL whose token can be rotated
 * underneath it, which this authenticated editor has no use for. Framing a
 * convex.site page here would also put a third site in the frame's ancestor
 * chain, making every engine request cross-site — dropping Scene Manager's
 * SameSite=Strict session cookie, which is what authorizes the widget frames and
 * the event stream inside the overlay. Loaded directly, a UI and an engine
 * sharing a registrable domain stay same-site.
 *
 * The preview's overlay token is its own, so rotating or revoking the public
 * browser-source URL leaves this untouched.
 *
 * The overlay renders the scene as last saved, and reloads itself whenever the
 * engine reports a save — as does every copy open in OBS. In between, the
 * editor's draft positions and sizes are posted into the frame on every change
 * and on every load, so a widget follows the drag before it is saved (see
 * docs/ui/scenes.md).
 */
export function LiveScenePreview({ sceneId, width, height, widgets }: LiveScenePreviewProps) {
  const getOrCreatePreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  // undefined = loading; null = not ready yet (scene not synced, or mint failed).
  const [overlayUrl, setOverlayUrl] = useState<string | null | undefined>(undefined);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Read by the frame's load handler, which must post the layout current at
  // load time rather than the one from the render that attached it.
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const postLayout = useCallback(
    (current: readonly Widget[]) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || !overlayUrl) {
        return;
      }
      // Addressed to the overlay's origin, so a frame that has navigated
      // somewhere else never receives it.
      frame.postMessage(buildPreviewLayoutMessage(current), new URL(overlayUrl).origin);
    },
    [overlayUrl]
  );

  useEffect(() => {
    postLayout(widgets);
  }, [widgets, postLayout]);

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
    // allow-same-origin is required alongside allow-scripts: the overlay nests one
    // iframe per widget and needs its own origin preserved to reach them. It grants
    // no access to this page's origin — the engine is a different host.
    //
    // pointer-events-none is required: an iframe swallows mousemove once the
    // cursor enters it, which would otherwise break the window-level drag
    // tracking CanvasWidgetHandle relies on for positioning widgets. This is a
    // preview surface only — nothing in it needs to be directly interactive.
    <iframe
      ref={frameRef}
      // Fires again each time the overlay reloads itself after a save; the
      // reloaded page knows only the saved layout, not a drag still in progress.
      onLoad={() => postLayout(widgetsRef.current)}
      src={overlayUrl}
      title="Scene preview"
      sandbox="allow-scripts allow-same-origin"
      // Chrome gates a public page reaching a private address behind the Local
      // Network Access permission, whose default allowlist is `self` — without this
      // an engine hostname that resolves to a LAN address (split-horizon DNS in dev)
      // is auto-denied with no prompt. Inert once the engine resolves publicly.
      allow="local-network-access"
      scrolling="no"
      className="absolute inset-0 z-[1] border-none bg-transparent pointer-events-none"
      style={{ width, height }}
      data-testid="live-scene-preview"
    />
  );
}
