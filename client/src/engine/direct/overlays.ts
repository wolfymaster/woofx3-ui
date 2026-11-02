import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { OverlaysGateway } from "@/engine/gateway";
import type { SceneId } from "@/engine/types";
import { fromSceneId } from "./ids";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";

/** The engine's status of an overlay token that still opens its scene. */
export const ACTIVE_TOKEN = "active";

/**
 * A scene's overlay URLs, straight from the engine's overlay tokens. The
 * editor and OBS run on the same machine as a directly driven engine, so a
 * preview shows the URL OBS loads rather than a token of its own: rotating
 * that URL only reloads the preview.
 */
export function directOverlaysGateway(runtime: DirectRuntime): OverlaysGateway {
  const activeToken = async (engineSceneId: string) => {
    const tokens = await runtime.call("listOverlayTokens", (api) => api.listOverlayTokens({ sceneId: engineSceneId }));
    return tokens.find((token) => token.sceneId === engineSceneId && token.status === ACTIVE_TOKEN) ?? null;
  };

  const browserSourceUrl = async (sceneId: SceneId) => {
    const engineSceneId = fromSceneId(sceneId);
    const token = await activeToken(engineSceneId);
    if (token !== null) {
      return token.url;
    }
    const minted = await runtime.call("mintOverlayToken", (api) => api.mintOverlayToken({ sceneId: engineSceneId }));
    return minted.url;
  };

  const rotateBrowserSourceUrl = async (sceneId: SceneId) => {
    const engineSceneId = fromSceneId(sceneId);
    const token = await activeToken(engineSceneId);
    if (token === null) {
      const minted = await runtime.call("mintOverlayToken", (api) => api.mintOverlayToken({ sceneId: engineSceneId }));
      return minted.url;
    }
    const rotated = await runtime.call("rotateOverlayToken", (api) =>
      api.rotateOverlayToken({ tokenId: token.tokenId })
    );
    return rotated.url;
  };

  // The contract's null for a scene the engine does not have, asked before a
  // token is minted for it; an engine that cannot say refuses the mint instead.
  const previewUrl = async (sceneId: SceneId) => {
    if (runtime.supports(ENGINE_CAPABILITIES.scenesSnapshots)) {
      const engineSceneId = fromSceneId(sceneId);
      const scene = await runtime.call("getSceneSnapshot", (api) => api.getSceneSnapshot(engineSceneId));
      if (scene === null) {
        return null;
      }
    }
    return browserSourceUrl(sceneId);
  };

  return {
    // A local engine answers the request itself about as fast as a read.
    useKnownPreviewUrl: () => null,
    useBrowserSourceUrlRequest: () => useEngineRequest(browserSourceUrl),
    useRotateBrowserSourceUrlRequest: () => useEngineRequest(rotateBrowserSourceUrl),
    usePreviewUrlRequest: () => useEngineRequest(previewUrl),
  };
}
