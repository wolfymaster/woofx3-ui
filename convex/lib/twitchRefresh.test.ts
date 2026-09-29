import { describe, expect, test } from "bun:test";
import { isRevokedRefreshResponse, refreshOutcomeApplies } from "./twitchRefresh";

describe("isRevokedRefreshResponse", () => {
  test("recognises Twitch's answer for a revoked grant", () => {
    expect(isRevokedRefreshResponse(400, '{"status":400,"message":"Invalid refresh token"}')).toBe(true);
  });

  test("a 400 for another reason is not a revocation", () => {
    expect(isRevokedRefreshResponse(400, '{"status":400,"message":"invalid client secret"}')).toBe(false);
    expect(isRevokedRefreshResponse(400, "not json")).toBe(false);
  });

  test("server errors and other statuses are transient", () => {
    expect(isRevokedRefreshResponse(500, '{"message":"Invalid refresh token"}')).toBe(false);
    expect(isRevokedRefreshResponse(401, '{"message":"Invalid refresh token"}')).toBe(false);
    expect(isRevokedRefreshResponse(429, "")).toBe(false);
  });
});

describe("refreshOutcomeApplies", () => {
  test("applies while the link still holds the token that was exchanged", () => {
    expect(refreshOutcomeApplies({ refreshToken: "r1" }, "r1")).toBe(true);
  });

  // A relink between reading the link and hearing back from Twitch replaced
  // the token; a late "Invalid refresh token" for the old one must not mark
  // the new grant revoked, and late new tokens must not overwrite it.
  test("does not apply after a relink replaced the token", () => {
    expect(refreshOutcomeApplies({ refreshToken: "r2" }, "r1")).toBe(false);
  });

  test("does not apply to a deleted link", () => {
    expect(refreshOutcomeApplies(null, "r1")).toBe(false);
  });
});
