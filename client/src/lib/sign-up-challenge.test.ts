import { describe, expect, test } from "bun:test";
import { signUpSiteKey, TURNSTILE_ALWAYS_PASSES_SITE_KEY } from "./sign-up-challenge";

describe("signUpSiteKey", () => {
  test("uses the configured key", () => {
    expect(signUpSiteKey("0x4AAAAAAA_key-1", false)).toBe("0x4AAAAAAA_key-1");
  });

  test("a development build without one uses the test key", () => {
    expect(signUpSiteKey(undefined, true)).toBe(TURNSTILE_ALWAYS_PASSES_SITE_KEY);
    expect(signUpSiteKey("", true)).toBe(TURNSTILE_ALWAYS_PASSES_SITE_KEY);
  });

  test("a production build without one fails loudly", () => {
    expect(() => signUpSiteKey(undefined, false)).toThrow("VITE_TURNSTILE_SITE_KEY is not set");
    expect(() => signUpSiteKey("", false)).toThrow("VITE_TURNSTILE_SITE_KEY is not set");
  });

  test("a value that cannot be a key fails loudly", () => {
    expect(() => signUpSiteKey("not a key!", true)).toThrow("not a site key");
  });
});
