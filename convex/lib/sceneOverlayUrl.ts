/**
 * The engine's Scene Manager serves a scene at `{publicUrl}/scene/{engineSceneId}?token={token}`.
 *
 * Overlay-token URLs minted before Scene Manager replaced streamware's overlay rendering cached the
 * retired `{publicUrl}/overlay/{token}/` shape, which no engine service answers any more. Nothing
 * invalidates those rows on its own — `bustOverlayUrlCacheForInstance` only runs when the public URL
 * itself changes — so they have to be recognised and replaced wherever a cached URL is about to be
 * used. Kept here (rather than in browserSource.ts) so the HTTP browser-source route can apply the
 * same test without importing an action module.
 */
export function isCurrentSceneUrl(overlayUrl: string | undefined, engineSceneId: string): overlayUrl is string {
  if (!overlayUrl) {
    return false;
  }
  try {
    const parsed = new URL(overlayUrl);
    return parsed.pathname.endsWith(`/scene/${engineSceneId}`) && parsed.searchParams.get("token") !== null;
  } catch {
    return false;
  }
}
