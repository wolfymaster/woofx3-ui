// Pure HTML builders for the public browser-source page (kept separate from
// convex/http.ts so they can be unit-tested without the Convex runtime).
//
// Scenes are engine-authoritative and the engine renders the overlay itself, so
// this page is a thin wrapper that iframes the engine's per-scene overlay URL.
// The opaque browser-source key — not the engineSceneId — is what OBS holds, so
// revoking the key disables the overlay (the engine URL is never exposed to the
// client except inside the sandboxed iframe).

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
 * Wraps the engine overlay URL in a full-bleed sandboxed iframe.
 *
 * Sandbox flags: `allow-scripts allow-same-origin`.
 *  - `allow-scripts` lets the overlay run JavaScript.
 *  - `allow-same-origin` preserves the overlay's own origin (the engine
 *    host), which the overlay needs to nest its widget iframes and inject
 *    `widgetHost` into them. Without it, the overlay gets an opaque origin
 *    and any nested widget iframe — even with its own `allow-same-origin` —
 *    ends up cross-origin from its parent, so `iframe.contentWindow.widgetHost`
 *    assignment throws DOMException and widget events never reach widget code.
 *
 * `allow-same-origin` here does NOT grant the overlay access to this Convex
 * page's origin: the engine and Convex live on different hosts, so the
 * browser's same-origin policy still keeps the engine out of Convex
 * cookies/storage. It only stops the browser from minting a fresh opaque
 * origin for the overlay iframe.
 */
export function buildBrowserSourceHtml(params: { sceneName: string; overlayUrl: string }): string {
  const title = escapeHtml(params.sceneName);
  const src = escapeHtml(params.overlayUrl);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${BASE_STYLE}iframe{position:fixed;inset:0;width:100%;height:100%;border:none;background:transparent}</style>
</head>
<body>
<iframe src="${src}" sandbox="allow-scripts allow-same-origin" scrolling="no" allowtransparency="true"></iframe>
</body>
</html>`;
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
