import type { PreviewLayoutMessage } from "@woofx3/scene/editor";
import { useCallback, useEffect, useRef } from "react";
import { EngineFrame } from "@/components/common/engine-frame";
import { useScenePreviewUrl } from "@/engine/hooks/use-overlays";
import type { SceneId } from "@/engine/types";

interface LiveScenePreviewProps {
  engineSceneId: string;
  sceneId: SceneId | undefined;
  width: number;
  height: number;
  /**
   * The editor's scene as the overlay should show it, saved or not
   * (`editor.preview.layoutMessage()`). Without placements when the overlay
   * follows the draft: it is told only where widgets are being dragged, for
   * instant feedback, and gets everything else as ops.
   */
  layoutMessage: PreviewLayoutMessage | null;
  /** The overlay follows the scene's draft as sceneManager sequences it (an engine with editor sessions). */
  followDraft?: boolean;
  /**
   * `layoutMessage` names the version the overlay follows, so the frame stays
   * at one URL and switching versions never reloads its widgets.
   */
  viewByMessage?: boolean;
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
 * chain, making every engine request cross-site. Scene Manager's session
 * cookie, which authorizes the widget frames and the event stream inside the
 * overlay, is `SameSite=None; Secure; Partitioned` over HTTPS and on loopback,
 * so it survives a cross-site frame there, but on plain HTTP elsewhere (an
 * engine on the LAN) it is `SameSite=Strict` and only same-site frames get it.
 * Loaded directly, a UI and an engine sharing a registrable domain stay
 * same-site.
 *
 * The preview's overlay token is its own, so rotating or revoking the public
 * browser-source URL leaves this untouched.
 *
 * The overlay renders the scene as last saved, and applies each save the
 * engine reports in place — as does every copy open in OBS. The editor's draft
 * is posted into the frame on every change and on every load, so a widget
 * follows a drag, and shows a new setting or appears when added, before it is
 * saved (see docs/ui/scenes.md).
 */
export function LiveScenePreview({
  engineSceneId,
  sceneId,
  width,
  height,
  layoutMessage,
  followDraft = false,
  viewByMessage = false,
}: LiveScenePreviewProps) {
  // undefined = loading; null = not ready yet (scene not synced, or mint failed).
  const overlayUrl = useScenePreviewUrl(engineSceneId, sceneId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Read by the frame's load handler, which must post the layout current at
  // load time rather than the one from the render that attached it.
  const messageRef = useRef(layoutMessage);
  messageRef.current = layoutMessage;

  const postLayout = useCallback(
    (message: PreviewLayoutMessage | null) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || !overlayUrl || message === null) {
        return;
      }
      // Addressed to the overlay's origin, so a frame that has navigated
      // somewhere else never receives it.
      frame.postMessage(message, new URL(overlayUrl).origin);
    },
    [overlayUrl]
  );

  useEffect(() => {
    postLayout(layoutMessage);
  }, [layoutMessage, postLayout]);

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
    <EngineFrame
      frameRef={frameRef}
      // Fires again whenever the overlay reloads (a restarted engine, or a save
      // it could not apply in place); the reloaded page knows only the saved
      // scene, not the draft.
      onLoad={() => postLayout(messageRef.current)}
      src={followDraft || viewByMessage ? withDraftView(overlayUrl) : overlayUrl}
      title="Scene preview"
      className="absolute inset-0 z-[1]"
      width={width}
      height={height}
      testId="live-scene-preview"
    />
  );
}

/** The overlay URL showing the scene's draft rather than what is published. */
function withDraftView(overlayUrl: string): string {
  const url = new URL(overlayUrl);
  url.searchParams.set("view", "draft");
  return url.toString();
}
