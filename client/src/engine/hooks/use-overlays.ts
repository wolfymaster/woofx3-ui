import { useEffect, useState } from "react";
import { useEngineGateway } from "@/engine/context";
import type { SceneId } from "@/engine/types";

/** The URL OBS loads a scene from; the same URL until it is rotated. */
export function useBrowserSourceUrlRequest() {
  return useEngineGateway().overlays.useBrowserSourceUrlRequest();
}

/** Replaces a scene's browser-source URL, so the old one stops working. */
export function useRotateBrowserSourceUrlRequest() {
  return useEngineGateway().overlays.useRotateBrowserSourceUrlRequest();
}

/**
 * The URL of a scene's live overlay, for its preview: the one already known,
 * or else one asked for. Undefined while loading; null while there is none
 * (a scene not on the engine yet, or a request that was refused).
 */
export function useScenePreviewUrl(engineSceneId: string, sceneId: SceneId | undefined): string | null | undefined {
  const known = useEngineGateway().overlays.useKnownPreviewUrl(engineSceneId);
  const request = useOverlayPreviewUrlRequest();
  const [requested, setRequested] = useState<{ sceneId: SceneId; url: string | null } | undefined>(undefined);
  const needsRequest = known === null && sceneId !== undefined;

  useEffect(() => {
    if (!needsRequest || sceneId === undefined) {
      return;
    }
    let cancelled = false;
    request(sceneId).then((url) => {
      if (!cancelled) {
        setRequested({ sceneId, url });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsRequest, sceneId, request]);

  if (known !== null) {
    return known;
  }
  return requested?.sceneId === sceneId ? requested?.url : undefined;
}

/** A short-lived URL of a scene's live overlay, for previews. */
export function useOverlayPreviewUrlRequest() {
  return useEngineGateway().overlays.usePreviewUrlRequest();
}
