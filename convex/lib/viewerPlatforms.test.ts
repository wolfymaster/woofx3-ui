import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "../logger";
import { type FetchCall, stubFetch } from "./twitchEngineHelix.fakes";
import { subscriberTierFromTwitch, twitchGrantFromTokenBody, twitchViewerClient } from "./viewerPlatforms";

const CLIENT = twitchViewerClient({ clientId: "client", clientSecret: "secret" });
const NOW = 1_800_000_000_000;
const FOLLOWED = "https://api.twitch.tv/helix/channels/followed?user_id=V1&broadcaster_id=B1";
const SUBSCRIPTION = "https://api.twitch.tv/helix/subscriptions/user?user_id=V1&broadcaster_id=B1";

let fetchStub: ReturnType<typeof stubFetch> | null = null;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  warn.mockRestore();
});

function twitchAnswering(respond: (call: FetchCall) => Response) {
  fetchStub = stubFetch(respond);
  return fetchStub;
}

function rolesAnswering(follow: Response, subscription: Response) {
  return twitchAnswering((call) => {
    if (call.url === FOLLOWED) {
      return follow;
    }
    if (call.url === SUBSCRIPTION) {
      return subscription;
    }
    throw new Error(`unexpected request ${call.url}`);
  });
}

const FOLLOWING = () => Response.json({ data: [{ broadcaster_id: "B1", followed_at: "2026-01-01T00:00:00Z" }] });
const NOT_FOLLOWING = () => Response.json({ data: [] });
const NOT_SUBSCRIBED = () =>
  Response.json({ error: "Not Found", status: 404, message: "V1 has no subscription to B1" }, { status: 404 });
const subscribed = (tier: string) => Response.json({ data: [{ broadcaster_id: "B1", is_gift: false, tier }] });

describe("subscriberTierFromTwitch", () => {
  const cases: [unknown, ReturnType<typeof subscriberTierFromTwitch>][] = [
    ["1000", 1],
    ["2000", 2],
    ["3000", 3],
    ["4000", null],
    ["", null],
    [1000, null],
    [undefined, null],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} is ${expected}`, () => {
      expect(subscriberTierFromTwitch(input)).toBe(expected);
    });
  }
});

describe("checkRoles", () => {
  test("a 404 from the subscription endpoint means not subscribed", async () => {
    rolesAnswering(FOLLOWING(), NOT_SUBSCRIBED());
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({
      ok: true,
      value: { follower: true, subscriberTier: null },
    });
  });

  test("maps each subscription tier", async () => {
    for (const [tier, expected] of [
      ["1000", 1],
      ["2000", 2],
      ["3000", 3],
    ] as const) {
      fetchStub?.restore();
      rolesAnswering(NOT_FOLLOWING(), subscribed(tier));
      expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({
        ok: true,
        value: { follower: false, subscriberTier: expected },
      });
    }
  });

  test("an unknown tier on a real subscription counts as the lowest tier", async () => {
    rolesAnswering(NOT_FOLLOWING(), subscribed("9000"));
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({
      ok: true,
      value: { follower: false, subscriberTier: 1 },
    });
    expect(warn).toHaveBeenCalled();
  });

  test("asks with the viewer's token and the app's client id", async () => {
    const stub = rolesAnswering(NOT_FOLLOWING(), NOT_SUBSCRIBED());
    await CLIENT.checkRoles("viewer-token", "V1", "B1");
    for (const call of stub.calls) {
      expect(call.init?.headers).toEqual({ Authorization: "Bearer viewer-token", "Client-Id": "client" });
    }
  });

  test("a 401 on either call is unauthorized", async () => {
    rolesAnswering(new Response(null, { status: 401 }), NOT_SUBSCRIBED());
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({ ok: false, error: "unauthorized" });
    fetchStub?.restore();
    rolesAnswering(FOLLOWING(), new Response(null, { status: 401 }));
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({ ok: false, error: "unauthorized" });
  });

  test("any other failure is unavailable, never a wrong answer", async () => {
    rolesAnswering(new Response(null, { status: 503 }), NOT_SUBSCRIBED());
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({ ok: false, error: "unavailable" });
    fetchStub?.restore();
    rolesAnswering(FOLLOWING(), new Response(null, { status: 500 }));
    expect(await CLIENT.checkRoles("token", "V1", "B1")).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("refreshTokens", () => {
  test("a revoked refresh token is revoked", async () => {
    twitchAnswering(() => Response.json({ status: 400, message: "Invalid refresh token" }, { status: 400 }));
    expect(await CLIENT.refreshTokens("refresh", NOW)).toEqual({ ok: false, error: "revoked" });
  });

  test("any other refusal is unavailable", async () => {
    twitchAnswering(() => Response.json({ status: 400, message: "invalid client secret" }, { status: 400 }));
    expect(await CLIENT.refreshTokens("refresh", NOW)).toEqual({ ok: false, error: "unavailable" });
  });

  test("a renewal is a grant expiring after expires_in", async () => {
    twitchAnswering(() =>
      Response.json({ access_token: "a2", refresh_token: "r2", expires_in: 100, scope: ["user:read:follows"] })
    );
    expect(await CLIENT.refreshTokens("refresh", NOW)).toEqual({
      ok: true,
      value: { accessToken: "a2", refreshToken: "r2", expiresAt: NOW + 100_000, scopes: ["user:read:follows"] },
    });
  });
});

describe("twitchGrantFromTokenBody", () => {
  test("reads scopes given as a list or a space-separated string", () => {
    const body = { access_token: "a", refresh_token: "r", expires_in: 1 };
    expect(twitchGrantFromTokenBody({ ...body, scope: ["x", "y"] }, NOW)?.scopes).toEqual(["x", "y"]);
    expect(twitchGrantFromTokenBody({ ...body, scope: "x y" }, NOW)?.scopes).toEqual(["x", "y"]);
    expect(twitchGrantFromTokenBody(body, NOW)?.scopes).toEqual([]);
  });

  test("refuses a body missing a token or the lifetime", () => {
    expect(twitchGrantFromTokenBody({ access_token: "a", expires_in: 1 }, NOW)).toBeNull();
    expect(twitchGrantFromTokenBody({ access_token: "", refresh_token: "r", expires_in: 1 }, NOW)).toBeNull();
    expect(twitchGrantFromTokenBody({ access_token: "a", refresh_token: "r" }, NOW)).toBeNull();
    expect(twitchGrantFromTokenBody(null, NOW)).toBeNull();
  });
});

describe("authorizeUrl", () => {
  test("asks only for the follow and subscription read scopes", () => {
    const url = new URL(CLIENT.authorizeUrl("state-1", "https://example.convex.site/cb"));
    expect(url.origin + url.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("user:read:follows user:read:subscriptions");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.convex.site/cb");
  });
});
