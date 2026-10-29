import { describe, expect, test } from "bun:test";
import { base64UrlEncode } from "./oauthHandoff";
import { importTokenCipher, PLATFORM_TOKEN_KEY, type TokenKeySpec, VIEWER_TOKEN_KEY } from "./tokenCipher";

function randomKeyText(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

const SPECS: TokenKeySpec[] = [VIEWER_TOKEN_KEY, PLATFORM_TOKEN_KEY];

for (const spec of SPECS) {
  describe(`token cipher: ${spec.label}`, () => {
    test("opens what it sealed, and never stores the token in the clear", async () => {
      const cipher = await importTokenCipher(spec, randomKeyText());
      const sealed = await cipher.seal("access-token-123");
      expect(sealed.startsWith(`${spec.keyId}.`)).toBe(true);
      expect(sealed).not.toContain("access-token-123");
      expect(await cipher.open(sealed)).toBe("access-token-123");
    });

    test("seals the same token differently each time", async () => {
      const cipher = await importTokenCipher(spec, randomKeyText());
      expect(await cipher.seal("t")).not.toBe(await cipher.seal("t"));
    });

    test("refuses to open a value sealed under another key", async () => {
      const sealed = await (await importTokenCipher(spec, randomKeyText())).seal("t");
      await expect((await importTokenCipher(spec, randomKeyText())).open(sealed)).rejects.toThrow();
    });

    test("refuses a tampered or malformed value", async () => {
      const cipher = await importTokenCipher(spec, randomKeyText());
      const sealed = await cipher.seal("token");
      const tampered = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
      await expect(cipher.open(tampered)).rejects.toThrow();
      await expect(cipher.open("token")).rejects.toThrow(`not a sealed ${spec.label}`);
      await expect(cipher.open(`${spec.keyId}.!.b`)).rejects.toThrow(`not a sealed ${spec.label}`);
    });

    test("refuses an empty token", async () => {
      const cipher = await importTokenCipher(spec, randomKeyText());
      await expect(cipher.seal("")).rejects.toThrow(`refusing to seal an empty ${spec.label}`);
    });

    test("refuses a missing or wrong-sized key", async () => {
      await expect(importTokenCipher(spec, undefined)).rejects.toThrow(`${spec.envVar} is not set`);
      await expect(importTokenCipher(spec, base64UrlEncode(new Uint8Array(16)))).rejects.toThrow("must be 32 bytes");
      await expect(importTokenCipher(spec, "not base64!")).rejects.toThrow("must be 32 bytes");
    });
  });
}

describe("token cipher key ids", () => {
  test("a value sealed for one kind of token names its key, and the other kind refuses it", async () => {
    const keyText = randomKeyText();
    const viewer = await importTokenCipher(VIEWER_TOKEN_KEY, keyText);
    const platform = await importTokenCipher(PLATFORM_TOKEN_KEY, keyText);
    await expect(platform.open(await viewer.seal("t"))).rejects.toThrow('sealed under key "v1", not "p1"');
  });

  test("refuses a key id outside lowercase letters and digits", async () => {
    const spec: TokenKeySpec = { label: "test token", envVar: "TEST_KEY", keyId: "V.1" };
    await expect(importTokenCipher(spec, randomKeyText())).rejects.toThrow("must be lowercase letters and digits");
  });

  test("opens a viewer token sealed in the format viewer sign-in has always stored", async () => {
    // A fixed value under key bytes 0x00..0x1f. viewerPlatformTokens rows in
    // every deployment are in this format, so it must keep opening.
    const viewer = await importTokenCipher(VIEWER_TOKEN_KEY, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    const stored = "v1.3syISaOWw6RtTv24.3ViAmPp0voZgN8BLuk-GhAbPzImmm74w8uyBOSrrWYZQ1g4";
    expect(await viewer.open(stored)).toBe("viewer-access-token");
  });
});
