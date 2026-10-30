import { describe, expect, test } from "bun:test";
import { base64UrlEncode } from "./oauthHandoff";
import { openPlatformLinkTokens, sealPlatformLinkTokens } from "./platformLinkTokens";
import { importTokenCipher, PLATFORM_TOKEN_KEY } from "./tokenCipher";

async function newCipher() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return importTokenCipher(PLATFORM_TOKEN_KEY, base64UrlEncode(bytes));
}

const TOKENS = { accessToken: "access-1", refreshToken: "refresh-1" };

describe("platform link tokens", () => {
  test("open what was sealed, and the sealed pair holds neither token in the clear", async () => {
    const cipher = await newCipher();
    const sealed = await sealPlatformLinkTokens(cipher, TOKENS);
    expect(JSON.stringify(sealed)).not.toContain("access-1");
    expect(JSON.stringify(sealed)).not.toContain("refresh-1");
    expect(await openPlatformLinkTokens(cipher, sealed)).toEqual(TOKENS);
  });

  test("refuse a sealed pair under another key or tampered with", async () => {
    const sealed = await sealPlatformLinkTokens(await newCipher(), TOKENS);
    await expect(openPlatformLinkTokens(await newCipher(), sealed)).rejects.toThrow();
    const cipher = await newCipher();
    const mine = await sealPlatformLinkTokens(cipher, TOKENS);
    const last = mine.sealedAccessToken.slice(-1) === "A" ? "B" : "A";
    const tampered = { ...mine, sealedAccessToken: `${mine.sealedAccessToken.slice(0, -1)}${last}` };
    await expect(openPlatformLinkTokens(cipher, tampered)).rejects.toThrow();
  });
});
