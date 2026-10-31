import { describe, expect, test } from "bun:test";
import { generateOpaqueToken, hashOpaqueToken } from "./oauthHandoff";
import { isNonceHash, parseSignInClient, type SignInClient } from "./twitchSignIn";

describe("parseSignInClient", () => {
  const cases: [string | null, SignInClient | null][] = [
    [null, "web"],
    ["web", "web"],
    ["desktop", "desktop"],
    ["", null],
    ["Desktop", null],
    ["desktop ", null],
    ["mobile", null],
  ];
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} is ${JSON.stringify(expected)}`, () => {
      expect(parseSignInClient(raw)).toBe(expected);
    });
  }
});

describe("isNonceHash", () => {
  test("accepts what hashOpaqueToken produces", async () => {
    expect(isNonceHash(await hashOpaqueToken(generateOpaqueToken()))).toBe(true);
  });

  test("refuses anything else", () => {
    for (const value of [null, undefined, 42, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)]) {
      expect(isNonceHash(value)).toBe(false);
    }
  });

  test("refuses a raw nonce, so a nonce is never accepted where only its hash may travel", () => {
    expect(isNonceHash(generateOpaqueToken())).toBe(false);
  });
});
