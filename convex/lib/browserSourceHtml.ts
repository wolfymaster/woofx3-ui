// Pure response builders for the public browser-source route (kept separate from
// convex/http.ts so they can be unit-tested without the Convex runtime).
//
// Scenes are engine-authoritative and the engine renders the overlay itself. The
// opaque browser-source key — not the engine URL — is what OBS holds, so the
// token behind it can be rotated or re-minted without re-pasting anything into OBS.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BASE_STYLE =
  "*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:transparent;overflow:hidden}";

/**
 * Sends OBS on to the engine's overlay URL as a top-level navigation.
 *
 * A redirect, not an iframe: Scene Manager trades the URL's token for a session
 * cookie, and every follow-up request (widget frames, the `/events` stream,
 * delivery acks) authenticates with that cookie alone. On an engine reached
 * over plain HTTP away from loopback the cookie is `SameSite=Strict`, so framed
 * inside this convex.site page the overlay is cross-site to its top-level
 * document, the browser withholds the cookie and those requests 401. Once
 * redirected, the overlay *is* the top-level document and the cookie flows on
 * every engine.
 *
 * `no-store` so every OBS load re-resolves the key: rotation and re-minting swap
 * the token behind it, and a cached redirect would pin the old one.
 * `no-referrer` keeps the key URL — itself a bearer credential — out of the
 * engine's request logs.
 */
export function buildBrowserSourceRedirect(overlayUrl: string): Response {
  const target = new URL(overlayUrl);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`Refusing to redirect a browser source to a non-HTTP URL (${target.protocol})`);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Shown when the engine has no overlay base URL configured (storage not set up)
 * or the scene has not synced yet. OBS renders this transparently; the message
 * is only visible when previewing in a normal browser.
 */
export function buildBrowserSourcePlaceholderHtml(params: { sceneName: string; reason: string }): string {
  const title = escapeHtml(params.sceneName);
  const reason = escapeHtml(params.reason);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${BASE_STYLE}body{display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:rgba(255,255,255,0.6)}</style>
</head>
<body>
<p>${reason}</p>
</body>
</html>`;
}
