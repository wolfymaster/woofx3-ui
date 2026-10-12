import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceContext } from "./sceneActions";

// The alert editor's live preview (capability `compositions.preview`): a URL
// for sceneManager's composition preview page, which the editor frames and
// drives by postMessage (`@woofx3/scene/runtime`, preview-protocol.ts).
//
// The browser frames the URL directly, as the scene editor frames its overlay
// preview (see browserSource.getOrCreatePreviewUrl): a convex.site page in
// between would make every request to sceneManager cross-site and drop the
// page's SameSite=Strict session cookie.
//
// Nothing is stored. Unlike an overlay token, this one names no scene or
// composition and lives a few minutes, only long enough for the page to load
// and trade it for its own session, so there is nothing to rotate or revoke
// and a cached row would only hold a credential past its use. The browser
// keeps the answer until shortly before `expiresAt` and asks again after.

/** What the editor frames, and until when it may load it. */
export interface CompositionPreviewUrl {
  url: string;
  /** Epoch ms after which the page refuses the URL's token. */
  expiresAt: number;
}

/**
 * Null when the engine has no composition preview, or sceneManager did not
 * answer: the editor then keeps its own stand-ins. Each engine call has its
 * own capnweb session, since an HTTP batch session is spent by its first call.
 */
export const getUrl = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<CompositionPreviewUrl | null> => {
    const engine = await requireInstanceContext(ctx, instanceId);
    if (!hasEngineCapability(await fetchEngineCapabilities(engine), "compositions.preview")) {
      return null;
    }
    const requestedAt = Date.now();
    const answer = await createEngineRpcSession<EngineApi>(
      engine.url,
      engine.clientId,
      engine.clientSecret
    ).getCompositionPreviewUrl();
    if (answer === null) {
      return null;
    }
    if (typeof answer.url !== "string" || !(answer.expiresInSeconds > 0)) {
      throw new ConvexError("The engine answered the preview request with something that is not a preview URL.");
    }
    // Counted from before the request, so the browser never holds it past the engine's own expiry.
    return { url: answer.url, expiresAt: requestedAt + answer.expiresInSeconds * 1000 };
  },
});
