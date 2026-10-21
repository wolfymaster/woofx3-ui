import { useEngineGateway } from "@/engine/context";

/** The URL OBS loads a scene from; the same URL until it is rotated. */
export function useBrowserSourceUrlRequest() {
  return useEngineGateway().overlays.useBrowserSourceUrlRequest();
}

/** Replaces a scene's browser-source URL, so the old one stops working. */
export function useRotateBrowserSourceUrlRequest() {
  return useEngineGateway().overlays.useRotateBrowserSourceUrlRequest();
}

/** A short-lived URL of a scene's live overlay, for previews. */
export function useOverlayPreviewUrlRequest() {
  return useEngineGateway().overlays.usePreviewUrlRequest();
}
