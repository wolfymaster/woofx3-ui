import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

interface LiveScenePreviewProps {
  sceneId: Id<"scenes"> | undefined;
  width: number;
  height: number;
  /** Bumped by the editor after a save to remount the iframe — see below. */
  reloadToken?: number;
}

/**
 * Embeds the engine's Scene Manager overlay directly —
 * `{Scene Manager Public URL}/scene/{engineSceneId}?token={token}`, minted by
 * convex/browserSource.ts's getOrCreatePreviewUrl — so the canvas shows the real
 * overlay rather than a reimplementation of widget rendering.
 *
 * Deliberately NOT routed through the /browser-source/{key} page OBS loads. That
 * page exists to keep the engine URL and token out of a public browser source,
 * which this authenticated editor has no reason to do, and putting a third site
 * in the frame's ancestor chain would make every engine request cross-site —
 * dropping Scene Manager's SameSite=Strict session cookie, which is what
 * authorizes the widget frames and the event stream inside the overlay. Loaded
 * directly, a UI and an engine sharing a registrable domain stay same-site.
 *
 * The preview's overlay token is its own, so rotating or revoking the public
 * browser-source URL leaves this untouched.
 *
 * Reflects the last-saved scene state; unsaved edits only appear after Save
 * (see docs/ui/scenes.md).
 */
export function LiveScenePreview({ sceneId, width, height, reloadToken = 0 }: LiveScenePreviewProps) {
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
    // allow-same-origin is required alongside allow-scripts: the overlay nests one
    // iframe per widget and needs its own origin preserved to reach them. It grants
    // no access to this page's origin — the engine is a different host.
    //
    // pointer-events-none is required: an iframe swallows mousemove once the
    // cursor enters it, which would otherwise break the window-level drag
    // tracking CanvasWidgetHandle relies on for positioning widgets. This is a
    // preview surface only — nothing in it needs to be directly interactive.
    <iframe
      // The overlay reads its scene config once, when the document loads, and its
      // event stream carries only event deliveries — never config changes. Keying
      // on the save counter as well as the URL remounts the frame after a save, so
      // a widget the editor just added or moved actually appears.
      key={`${overlayUrl}#${reloadToken}`}
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
