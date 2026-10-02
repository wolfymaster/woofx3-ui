import { describe, expect, test } from "bun:test";
import { twitchTokenGrant } from "./twitchTokenGrant";

describe("twitchTokenGrant", () => {
  test("gives the token's remaining life as of now, with the app's client id and no refresh token", () => {
    const grant = twitchTokenGrant({
      accessToken: "access",
      broadcasterUserId: "42",
      expiresAt: 10_000_500,
      scopes: ["chat:read"],
      clientId: "woofx3-app",
      now: 7_000_000,
    });
    expect(grant).toEqual({
      userId: "42",
      accessToken: "access",
      scope: ["chat:read"],
      expiresIn: 3000,
      obtainmentTimestamp: 7_000_000,
      clientId: "woofx3-app",
    });
    expect("refreshToken" in grant).toBe(false);
  });

  test("never gives a negative life", () => {
    const grant = twitchTokenGrant({
      accessToken: "a",
      broadcasterUserId: "42",
      expiresAt: 1_000,
      scopes: [],
      clientId: "app",
      now: 5_000,
    });
    expect(grant.expiresIn).toBe(0);
  });
});
