import { describe, expect, test } from "bun:test";
import { base64UrlEncode } from "./oauthHandoff";
import {
  holdsPlaintextTokens,
  openPlatformLinkTokens,
  sealPlatformLinkTokens,
  storedRefreshToken,
  storedTokensPatch,
} from "./platformLinkTokens";
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

  test("read a row not sealed yet as it is", async () => {
    expect(await openPlatformLinkTokens(await newCipher(), TOKENS)).toEqual(TOKENS);
  });

  test("prefer the sealed pair when a row holds both", async () => {
    const cipher = await newCipher();
    const sealed = await sealPlatformLinkTokens(cipher, { accessToken: "new-a", refreshToken: "new-r" });
    expect(await openPlatformLinkTokens(cipher, { ...TOKENS, ...sealed })).toEqual({
      accessToken: "new-a",
      refreshToken: "new-r",
    });
    expect(storedRefreshToken({ ...TOKENS, ...sealed })).toBe(sealed.sealedRefreshToken);
  });

  test("refuse a row with no complete pair", async () => {
    const cipher = await newCipher();
    const sealed = await sealPlatformLinkTokens(cipher, TOKENS);
    await expect(openPlatformLinkTokens(cipher, {})).rejects.toThrow("no complete token pair");
    await expect(openPlatformLinkTokens(cipher, { accessToken: "a" })).rejects.toThrow("no complete token pair");
    await expect(openPlatformLinkTokens(cipher, { sealedAccessToken: sealed.sealedAccessToken })).rejects.toThrow(
      "half a sealed token pair"
    );
    expect(() => storedRefreshToken({})).toThrow("no complete token pair");
  });

  test("refuse a sealed pair under another key or tampered with", async () => {
    const sealed = await sealPlatformLinkTokens(await newCipher(), TOKENS);
    await expect(openPlatformLinkTokens(await newCipher(), sealed)).rejects.toThrow();
    const cipher = await newCipher();
    const mine = await sealPlatformLinkTokens(cipher, TOKENS);
    const tampered = { ...mine, sealedAccessToken: `${mine.sealedAccessToken.slice(0, -1)}A` };
    if (tampered.sealedAccessToken === mine.sealedAccessToken) {
      tampered.sealedAccessToken = `${mine.sealedAccessToken.slice(0, -1)}B`;
    }
    await expect(openPlatformLinkTokens(cipher, tampered)).rejects.toThrow();
  });

  test("a write patch stores the sealed pair and removes the plaintext one", async () => {
    const sealed = await sealPlatformLinkTokens(await newCipher(), TOKENS);
    const patch = storedTokensPatch(sealed);
    expect(patch).toEqual({ ...sealed, accessToken: undefined, refreshToken: undefined });
    expect("accessToken" in patch && "refreshToken" in patch).toBe(true);
  });

  test("know which rows still hold plaintext", async () => {
    const sealed = await sealPlatformLinkTokens(await newCipher(), TOKENS);
    expect(holdsPlaintextTokens(TOKENS)).toBe(true);
    expect(holdsPlaintextTokens({ ...TOKENS, ...sealed })).toBe(true);
    expect(holdsPlaintextTokens(sealed)).toBe(false);
  });
});
