import { describe, expect, test } from "bun:test";
import { base64UrlEncode } from "./oauthHandoff";
import { importViewerTokenKey, openViewerToken, sealViewerToken } from "./viewerTokenCipher";

function randomKeyText(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

describe("viewer token cipher", () => {
  test("opens what it sealed, and never stores the token in the clear", async () => {
    const key = await importViewerTokenKey(randomKeyText());
    const sealed = await sealViewerToken(key, "access-token-123");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("access-token-123");
    expect(await openViewerToken(key, sealed)).toBe("access-token-123");
  });

  test("seals the same token differently each time", async () => {
    const key = await importViewerTokenKey(randomKeyText());
    expect(await sealViewerToken(key, "t")).not.toBe(await sealViewerToken(key, "t"));
  });

  test("refuses to open a value sealed under another key", async () => {
    const sealed = await sealViewerToken(await importViewerTokenKey(randomKeyText()), "t");
    await expect(openViewerToken(await importViewerTokenKey(randomKeyText()), sealed)).rejects.toThrow();
  });

  test("refuses a tampered or malformed value", async () => {
    const key = await importViewerTokenKey(randomKeyText());
    const sealed = await sealViewerToken(key, "token");
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    await expect(openViewerToken(key, tampered)).rejects.toThrow();
    await expect(openViewerToken(key, "token")).rejects.toThrow("not a sealed viewer token");
    await expect(openViewerToken(key, "v2.a.b")).rejects.toThrow("not a sealed viewer token");
  });

  test("refuses a missing or wrong-sized key", async () => {
    await expect(importViewerTokenKey(undefined)).rejects.toThrow("VIEWER_TOKEN_ENCRYPTION_KEY is not set");
    await expect(importViewerTokenKey(base64UrlEncode(new Uint8Array(16)))).rejects.toThrow("must be 32 bytes");
    await expect(importViewerTokenKey("not base64!")).rejects.toThrow("must be 32 bytes");
  });
});
