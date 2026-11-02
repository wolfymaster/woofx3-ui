import { api } from "@convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { OverlaysGateway } from "@/engine/gateway";
import { NoInstanceSelectedError } from "@/engine/scope";
import type { OverlayFacts, OverlayMilestone, ReadOptions, SceneId } from "@/engine/types";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import { fromSceneId } from "./ids";
import { useMappedValue } from "./mapped";
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

const MILESTONE_ITEM_IDS = { "overlay-added": "overlay", "test-alert": "test-alert" } as const satisfies Record<
  OverlayMilestone,
  string
>;

function useRecordMilestoneRequest() {
  const instanceId = useScopeInstanceId();
  const markDone = useMutation(api.gettingStarted.markDone);
  return useCallback(
    async (milestone: OverlayMilestone) => {
      if (!instanceId) {
        throw new NoInstanceSelectedError();
      }
      await markDone({ instanceId, itemId: MILESTONE_ITEM_IDS[milestone] });
    },
    [instanceId, markDone]
  );
}

type FactsRow = NonNullable<FunctionReturnType<typeof api.browserSource.overlayFacts>>;

export function toOverlayFacts(row: FactsRow): OverlayFacts {
  return {
    hasScene: row.hasScene,
    browserSourceKeyCount: row.browserSourceKeyCount,
    featuredUrl: row.featuredKey ? browserSourceUrlForKey(row.featuredKey) : null,
    lastLoadedAt: row.lastLoadedAt,
  };
}

function useFacts({ enabled = true }: ReadOptions = {}) {
  const instanceId = useScopeInstanceId();
  const row = useQuery(api.browserSource.overlayFacts, enabled && instanceId ? { instanceId } : "skip");
  return useMappedValue(row, toOverlayFacts);
}

export const convexOverlaysGateway: OverlaysGateway = {
  useFacts,
  useKnownPreviewUrl,
  useBrowserSourceUrlRequest,
  useRotateBrowserSourceUrlRequest,
  usePreviewUrlRequest,
  useRecordMilestoneRequest,
};
