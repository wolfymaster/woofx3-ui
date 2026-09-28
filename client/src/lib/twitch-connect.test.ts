import { describe, expect, test } from "bun:test";
import { twitchConnectUrl } from "./twitch-connect";

describe("twitchConnectUrl", () => {
  test("targets the start route with the instance and an encoded return path", () => {
    const url = new URL(twitchConnectUrl("https://example.convex.site", "abc123", "/stream/alerts?tab=log"));
    expect(url.origin + url.pathname).toBe("https://example.convex.site/api/integrations/twitch/start");
    expect(url.searchParams.get("instanceId")).toBe("abc123");
    expect(url.searchParams.get("redirect_to")).toBe("/stream/alerts?tab=log");
  });

  test("refuses to build a URL without an instance", () => {
    expect(() => twitchConnectUrl("https://example.convex.site", "", "/")).toThrow();
  });
});
