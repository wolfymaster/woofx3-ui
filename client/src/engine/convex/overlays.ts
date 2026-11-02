import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import type { OverlaysGateway } from "@/engine/gateway";
import type { SceneId } from "@/engine/types";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import { fromSceneId } from "./ids";
import { useScopeInstanceId } from "./scope";

// The engine mints the overlay token a scene's URL carries; Convex keeps it
// behind a stable key of its own, served at its /browser-source/<key> route,
// so the URL OBS holds survives a token the engine rotates. The preview URL
// is the engine's own, minted fresh for the editor.

function useBrowserSourceUrlRequest() {
  const getOrCreateBrowserSourceKey = useAction(api.browserSource.getOrCreateBrowserSourceKey);
  return useCallback(
    async (sceneId: SceneId) =>
      browserSourceUrlForKey(await getOrCreateBrowserSourceKey({ sceneId: fromSceneId(sceneId) })),
    [getOrCreateBrowserSourceKey]
  );
}

function useRotateBrowserSourceUrlRequest() {
  const rotateBrowserSourceKey = useAction(api.browserSource.rotateBrowserSourceKey);
  return useCallback(
    async (sceneId: SceneId) => browserSourceUrlForKey(await rotateBrowserSourceKey({ sceneId: fromSceneId(sceneId) })),
    [rotateBrowserSourceKey]
  );
}

function usePreviewUrlRequest() {
  const getOrCreatePreviewUrl = useAction(api.browserSource.getOrCreatePreviewUrl);
  return useCallback(
    (sceneId: SceneId) => getOrCreatePreviewUrl({ sceneId: fromSceneId(sceneId) }),
    [getOrCreatePreviewUrl]
  );
}

function useKnownPreviewUrl(engineSceneId: string) {
  const instanceId = useScopeInstanceId();
  return useQuery(api.scenes.previewUrlByEngineSceneId, instanceId ? { instanceId, engineSceneId } : "skip");
}

export const convexOverlaysGateway: OverlaysGateway = {
  useKnownPreviewUrl,
  useBrowserSourceUrlRequest,
  useRotateBrowserSourceUrlRequest,
  usePreviewUrlRequest,
};
