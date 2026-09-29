import { describe, expect, test } from "bun:test";
import { isOAuthErrorCode, OAUTH_ERROR_CODES, oauthErrorMessage } from "./oauthErrors";

describe("oauthErrorMessage", () => {
  test("every code has its own fixed text naming the provider where it matters", () => {
    const texts = new Set<string>();
    for (const code of OAUTH_ERROR_CODES) {
      const text = oauthErrorMessage(code, "Twitch");
      expect(text.length).toBeGreaterThan(0);
      texts.add(text);
    }
    expect(texts.size).toBe(OAUTH_ERROR_CODES.length);
    expect(oauthErrorMessage("access_denied", "Spotify")).toContain("Spotify");
  });

  test("never echoes an unknown value", () => {
    const hostile = "Your account is locked. Call +1 555 0100 to restore it.";
    const text = oauthErrorMessage(hostile, "Twitch");
    expect(text).not.toContain("555");
    expect(text).toBe(oauthErrorMessage(null, "Twitch"));
    expect(oauthErrorMessage(undefined, "Twitch")).toBe(text);
  });

  test("an inherited property name is not a code", () => {
    expect(isOAuthErrorCode("toString")).toBe(false);
    expect(isOAuthErrorCode("constructor")).toBe(false);
    expect(isOAuthErrorCode("access_denied")).toBe(true);
  });
});
