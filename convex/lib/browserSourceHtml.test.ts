import { describe, expect, test } from "bun:test";
import { buildBrowserSourcePlaceholderHtml, buildBrowserSourceRedirect, escapeHtml } from "./browserSourceHtml";

describe("escapeHtml", () => {
  test("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  test("leaves ordinary text untouched", () => {
    expect(escapeHtml("My Stream Overlay 123")).toBe("My Stream Overlay 123");
  });
});

describe("buildBrowserSourceRedirect", () => {
  const overlayUrl = "https://scenes.example/scene/abc?token=ovl_1";

  // The token must survive the hop: Scene Manager's shell is the only engine
  // route that accepts it, and it is what mints the session cookie.
  test("redirects to the overlay URL with the token intact", () => {
    const response = buildBrowserSourceRedirect(overlayUrl);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(overlayUrl);
  });

  // Rotation swaps the token behind a key; a cached redirect would pin the old one.
  test("is never cached", () => {
    expect(buildBrowserSourceRedirect(overlayUrl).headers.get("Cache-Control")).toBe("no-store");
  });

  test("keeps the key URL out of the engine's Referer", () => {
    expect(buildBrowserSourceRedirect(overlayUrl).headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  test("refuses a non-HTTP target", () => {
    expect(() => buildBrowserSourceRedirect("javascript:alert(1)")).toThrow();
  });

  test("refuses a malformed URL", () => {
    expect(() => buildBrowserSourceRedirect("not a url")).toThrow();
  });
});

describe("buildBrowserSourcePlaceholderHtml", () => {
  test("escapes scene name and reason", () => {
    const html = buildBrowserSourcePlaceholderHtml({
      sceneName: "<b>x</b>",
      reason: "<i>not configured</i>",
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>not configured</i>");
    expect(html).toContain("&lt;b&gt;");
  });
});
