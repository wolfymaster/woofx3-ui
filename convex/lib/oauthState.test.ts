import { describe, expect, test } from "bun:test";
import { forwardedCallbackUrl, mintOAuthState, type OAuthStateConfig, routeOAuthState } from "./oauthState";

const PRODUCTION = "https://standing-bandicoot-462.convex.site";
const PREVIEW = "https://insightful-swan-52.convex.site";
const SECRET = "shared-secret";

const production: OAuthStateConfig = { siteUrl: PRODUCTION, callbackBaseUrl: PRODUCTION, secret: SECRET };
const preview: OAuthStateConfig = { siteUrl: PREVIEW, callbackBaseUrl: PRODUCTION, secret: SECRET };

function encodeOrigin(origin: string): string {
  return btoa(origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("a deployment's own callbacks", () => {
  test("are handled where they arrive", async () => {
    expect(await routeOAuthState(await mintOAuthState(production), production)).toEqual({ kind: "here" });
  });

  test("need no secret", async () => {
    const dev: OAuthStateConfig = { siteUrl: PREVIEW, callbackBaseUrl: PREVIEW, secret: undefined };
    const state = await mintOAuthState(dev);
    expect(state.split(".")).toHaveLength(2);
    expect(await routeOAuthState(state, dev)).toEqual({ kind: "here" });
  });

  test("include states minted without an origin", async () => {
    expect(await routeOAuthState(crypto.randomUUID(), production)).toEqual({ kind: "here" });
  });
});

describe("a preview's callbacks", () => {
  test("are forwarded by production to the preview that minted the state", async () => {
    const state = await mintOAuthState(preview);
    expect(await routeOAuthState(state, production)).toEqual({ kind: "forward", origin: PREVIEW });
    expect(await routeOAuthState(state, preview)).toEqual({ kind: "here" });
  });

  test("cannot be minted without the shared secret", async () => {
    await expect(mintOAuthState({ ...preview, secret: undefined })).rejects.toThrow("OAUTH_STATE_SECRET");
  });

  test("are not forwarded with another secret's signature", async () => {
    const state = await mintOAuthState({ ...preview, secret: "another-secret" });
    expect(await routeOAuthState(state, production)).toEqual({ kind: "invalid" });
  });

  test("are not forwarded by a deployment without the secret", async () => {
    const state = await mintOAuthState(preview);
    expect(await routeOAuthState(state, { ...production, secret: undefined })).toEqual({ kind: "invalid" });
  });

  test("are not forwarded to an origin swapped into a signed state", async () => {
    const [random, , signature] = (await mintOAuthState(preview)).split(".");
    const forged = `${random}.${encodeOrigin("https://attacker.convex.site")}.${signature}`;
    expect(await routeOAuthState(forged, production)).toEqual({ kind: "invalid" });
  });

  test("are not forwarded without a signature", async () => {
    const [random, origin] = (await mintOAuthState(preview)).split(".");
    expect(await routeOAuthState(`${random}.${origin}`, production)).toEqual({ kind: "invalid" });
  });
});

describe("a malformed state", () => {
  test.each([
    ["too many parts", "a.b.c.d"],
    ["a random part of the wrong shape", `short.${encodeOrigin(PREVIEW)}.sig`],
    ["an origin that is not base64url", `${"A".repeat(43)}.not base64!.sig`],
    ["an origin with a path", `${"A".repeat(43)}.${encodeOrigin(`${PREVIEW}/elsewhere`)}.sig`],
  ])("with %s is refused", async (_label, state) => {
    expect(await routeOAuthState(state, production)).toEqual({ kind: "invalid" });
  });
});

describe("forwardedCallbackUrl", () => {
  test("keeps the callback's path and query", () => {
    const callback = new URL(`${PRODUCTION}/api/auth/twitch/callback?code=abc&state=s.t.u`);
    expect(forwardedCallbackUrl(PREVIEW, callback)).toBe(`${PREVIEW}/api/auth/twitch/callback?code=abc&state=s.t.u`);
  });
});
