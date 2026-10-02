import { describe, expect, test } from "bun:test";
import { twitchTokenForEngine, twitchTokenGrant } from "./twitchTokenGrant";

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

describe("twitchTokenForEngine", () => {
  const link = {
    platformUserId: "42",
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 10_000_000,
    scopes: ["chat:read"],
  };

  test("gives an engine that asks for tokens no refresh token", () => {
    const token = twitchTokenForEngine({ link, asksForTokens: true, clientId: "app", now: 7_000_000 });
    expect(token).toEqual({
      userId: "42",
      accessToken: "a",
      expiresIn: 3000,
      obtainmentTimestamp: 7_000_000,
      scope: ["chat:read"],
      clientId: "app",
    });
    expect("refreshToken" in token).toBe(false);
  });

  test("still gives an engine that refreshes itself the refresh token", () => {
    expect(twitchTokenForEngine({ link, asksForTokens: false, clientId: "app", now: 7_000_000 }).refreshToken).toBe(
      "r"
    );
  });
});
