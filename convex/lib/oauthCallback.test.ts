import { describe, expect, test } from "bun:test";
import { oauthCallbackUrl } from "./oauthCallback";

describe("oauthCallbackUrl", () => {
  test("appends the provider's callback route to the site URL", () => {
    expect(oauthCallbackUrl("twitch", "https://avid-eagle-113.convex.site")).toBe(
      "https://avid-eagle-113.convex.site/api/auth/twitch/callback"
    );
    expect(oauthCallbackUrl("module", "https://avid-eagle-113.convex.site")).toBe(
      "https://avid-eagle-113.convex.site/api/integrations/oauth/callback"
    );
  });

  test("does not double the slash after a site URL that ends in one", () => {
    expect(oauthCallbackUrl("twitch", "https://avid-eagle-113.convex.site/")).toBe(
      "https://avid-eagle-113.convex.site/api/auth/twitch/callback"
    );
  });

  test("fails without a site URL", () => {
    expect(() => oauthCallbackUrl("twitch", "")).toThrow("CONVEX_SITE_URL is not set");
  });
});
