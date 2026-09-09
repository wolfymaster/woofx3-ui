import { describe, expect, test } from "bun:test";
import { buildBrowserSourceHtml, buildBrowserSourcePlaceholderHtml, escapeHtml } from "./browserSourceHtml";

describe("escapeHtml", () => {
  test("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  test("leaves ordinary text untouched", () => {
    expect(escapeHtml("My Stream Overlay 123")).toBe("My Stream Overlay 123");
  });
});

describe("buildBrowserSourceHtml", () => {
  test("embeds the overlay URL in the iframe src", () => {
    const html = buildBrowserSourceHtml({ sceneName: "Scene", overlayUrl: "https://engine.example/overlay/abc" });
    expect(html).toContain('src="https://engine.example/overlay/abc"');
  });

  // allow-same-origin is required, not an oversight: the overlay nests one iframe
  // per widget and needs its own origin preserved to reach them. It grants no
  // access to this page's origin — the engine is a different host.
  test("grants allow-scripts and allow-same-origin, and nothing else", () => {
    const html = buildBrowserSourceHtml({ sceneName: "Scene", overlayUrl: "https://e/o/1" });
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).not.toContain("allow-popups");
    expect(html).not.toContain("allow-top-navigation");
  });

  test("delegates Local Network Access so a LAN-resolved engine can prompt", () => {
    const html = buildBrowserSourceHtml({ sceneName: "Scene", overlayUrl: "https://e/o/1" });
    expect(html).toContain('allow="local-network-access"');
  });

  test("escapes a malicious scene name (no XSS via title)", () => {
    const html = buildBrowserSourceHtml({
      sceneName: "</title><script>alert(1)</script>",
      overlayUrl: "https://e/o/1",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes a malicious overlay URL (no attribute breakout)", () => {
    const html = buildBrowserSourceHtml({
      sceneName: "Scene",
      overlayUrl: `https://e/o/1"></iframe><script>alert(1)</script>`,
    });
    expect(html).not.toContain("</iframe><script>");
    expect(html).toContain("&quot;");
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
