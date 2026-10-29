import { describe, expect, test } from "bun:test";
import { VIEWER_ROLES_TTL_MS, VIEWER_ROLES_UNAVAILABLE_TTL_MS } from "./viewerAuth";
import type { PlatformResult, ViewerPlatformClient, ViewerRoleFacts, ViewerTokenGrant } from "./viewerPlatforms";
import { refreshViewerRoles, VIEWER_TOKEN_REFRESH_MARGIN_MS } from "./viewerRoleRefresh";

const NOW = 1_800_000_000_000;
const GRANT: ViewerTokenGrant = { accessToken: "a1", refreshToken: "r1", expiresAt: NOW + 60 * 60_000, scopes: [] };
const RENEWED: ViewerTokenGrant = {
  accessToken: "a2",
  refreshToken: "r2",
  expiresAt: NOW + 4 * 60 * 60_000,
  scopes: [],
};
const FOLLOWER: ViewerRoleFacts = { follower: true, subscriberTier: 2 };

type RoleAnswer = PlatformResult<ViewerRoleFacts, "unauthorized" | "unavailable">;
type RefreshAnswer = PlatformResult<ViewerTokenGrant, "revoked" | "unavailable">;

/** A platform client that answers from queues and records what it was asked. */
function fakeClient(answers: { roles?: RoleAnswer[]; refresh?: RefreshAnswer[] }) {
  const asked: string[] = [];
  const roles = [...(answers.roles ?? [])];
  const refresh = [...(answers.refresh ?? [])];
  const client: ViewerPlatformClient = {
    authorizeUrl: () => {
      throw new Error("not used");
    },
    exchangeCode: () => {
      throw new Error("not used");
    },
    fetchProfile: () => {
      throw new Error("not used");
    },
    refreshTokens: async (refreshToken) => {
      asked.push(`refresh:${refreshToken}`);
      const answer = refresh.shift();
      if (!answer) {
        throw new Error("unexpected refresh");
      }
      return answer;
    },
    checkRoles: async (accessToken) => {
      asked.push(`roles:${accessToken}`);
      const answer = roles.shift();
      if (!answer) {
        throw new Error("unexpected role check");
      }
      return answer;
    },
  };
  return { client, asked };
}

function input(client: ViewerPlatformClient, overrides: Partial<Parameters<typeof refreshViewerRoles>[0]> = {}) {
  return {
    client,
    now: NOW,
    cached: null,
    outage: null,
    grant: GRANT,
    viewerPlatformUserId: "V1",
    broadcasterPlatformUserId: "B1",
    admit: async () => true,
    ...overrides,
  };
}

describe("role cache TTL", () => {
  test("uses cached roles within the TTL without asking the platform", async () => {
    const { client, asked } = fakeClient({});
    const cached = { follower: false, subscriberTier: null, checkedAt: NOW - VIEWER_ROLES_TTL_MS + 1 };
    expect(await refreshViewerRoles(input(client, { cached }))).toEqual({ kind: "cached", roles: cached });
    expect(asked).toEqual([]);
  });

  test("asks the platform once the cache is older than the TTL", async () => {
    const { client, asked } = fakeClient({ roles: [{ ok: true, value: FOLLOWER }] });
    const cached = { follower: false, subscriberTier: null, checkedAt: NOW - VIEWER_ROLES_TTL_MS };
    expect(await refreshViewerRoles(input(client, { cached }))).toEqual({
      kind: "checked",
      roles: FOLLOWER,
      refreshedGrant: null,
    });
    expect(asked).toEqual(["roles:a1"]);
  });

  test("a fresh cache is used even when the viewer must sign in again", async () => {
    const { client } = fakeClient({});
    const cached = { follower: true, subscriberTier: null, checkedAt: NOW };
    expect((await refreshViewerRoles(input(client, { cached, grant: null }))).kind).toBe("cached");
  });
});

describe("tokens", () => {
  test("no usable grant means signing in again", async () => {
    const { client, asked } = fakeClient({});
    expect(await refreshViewerRoles(input(client, { grant: null }))).toEqual({
      kind: "reauth_required",
      revoked: false,
    });
    expect(asked).toEqual([]);
  });

  test("renews a token close to expiry before using it", async () => {
    const { client, asked } = fakeClient({
      refresh: [{ ok: true, value: RENEWED }],
      roles: [{ ok: true, value: FOLLOWER }],
    });
    const grant = { ...GRANT, expiresAt: NOW + VIEWER_TOKEN_REFRESH_MARGIN_MS };
    expect(await refreshViewerRoles(input(client, { grant }))).toEqual({
      kind: "checked",
      roles: FOLLOWER,
      refreshedGrant: RENEWED,
    });
    expect(asked).toEqual(["refresh:r1", "roles:a2"]);
  });

  test("a revoked refresh token means signing in again, marked as revoked", async () => {
    const { client } = fakeClient({ refresh: [{ ok: false, error: "revoked" }] });
    const grant = { ...GRANT, expiresAt: NOW };
    expect(await refreshViewerRoles(input(client, { grant }))).toEqual({ kind: "reauth_required", revoked: true });
  });

  test("an unauthorized check renews once and retries", async () => {
    const { client, asked } = fakeClient({
      roles: [
        { ok: false, error: "unauthorized" },
        { ok: true, value: FOLLOWER },
      ],
      refresh: [{ ok: true, value: RENEWED }],
    });
    expect(await refreshViewerRoles(input(client))).toEqual({
      kind: "checked",
      roles: FOLLOWER,
      refreshedGrant: RENEWED,
    });
    expect(asked).toEqual(["roles:a1", "refresh:r1", "roles:a2"]);
  });

  test("still unauthorized after renewing means signing in again, not revoked", async () => {
    const { client } = fakeClient({
      roles: [
        { ok: false, error: "unauthorized" },
        { ok: false, error: "unauthorized" },
      ],
      refresh: [{ ok: true, value: RENEWED }],
    });
    expect(await refreshViewerRoles(input(client))).toEqual({ kind: "reauth_required", revoked: false });
  });

  test("an unavailable platform keeps a renewal made on the way", async () => {
    const { client } = fakeClient({
      refresh: [{ ok: true, value: RENEWED }],
      roles: [{ ok: false, error: "unavailable" }],
    });
    const grant = { ...GRANT, expiresAt: NOW };
    expect(await refreshViewerRoles(input(client, { grant }))).toEqual({
      kind: "unavailable",
      refreshedGrant: RENEWED,
      fromOutage: false,
    });
  });
});

describe("unavailable results are cached briefly", () => {
  test("a recent outage answers unavailable without asking the platform", async () => {
    const { client, asked } = fakeClient({});
    const outage = { failedAt: NOW - VIEWER_ROLES_UNAVAILABLE_TTL_MS + 1 };
    expect(await refreshViewerRoles(input(client, { outage }))).toEqual({
      kind: "unavailable",
      refreshedGrant: null,
      fromOutage: true,
    });
    expect(asked).toEqual([]);
  });

  test("asks the platform again once the outage window has passed", async () => {
    const { client, asked } = fakeClient({ roles: [{ ok: true, value: FOLLOWER }] });
    const outage = { failedAt: NOW - VIEWER_ROLES_UNAVAILABLE_TTL_MS };
    expect((await refreshViewerRoles(input(client, { outage }))).kind).toBe("checked");
    expect(asked).toEqual(["roles:a1"]);
  });

  test("a fresh role cache still answers during an outage", async () => {
    const { client } = fakeClient({});
    const cached = { follower: true, subscriberTier: null, checkedAt: NOW };
    expect((await refreshViewerRoles(input(client, { cached, outage: { failedAt: NOW } }))).kind).toBe("cached");
  });

  test("a failed check is reported as a new outage, not one from the cache", async () => {
    const { client } = fakeClient({ roles: [{ ok: false, error: "unavailable" }] });
    expect(await refreshViewerRoles(input(client))).toEqual({
      kind: "unavailable",
      refreshedGrant: null,
      fromOutage: false,
    });
  });
});

describe("per-viewer rate limit", () => {
  /** A gate that admits `allowed` calls and counts every time it was asked. */
  function gate(allowed: number) {
    let asked = 0;
    return {
      admit: async () => {
        asked += 1;
        return asked <= allowed;
      },
      asked: () => asked,
    };
  }

  test("a refused gate stops the refresh before the platform is called", async () => {
    const { client, asked } = fakeClient({});
    const limit = gate(0);
    expect(await refreshViewerRoles(input(client, { admit: limit.admit }))).toEqual({ kind: "rate_limited" });
    expect(asked).toEqual([]);
  });

  test("cache hits and outage answers do not spend the bucket", async () => {
    const { client } = fakeClient({});
    const limit = gate(0);
    const cached = { follower: true, subscriberTier: null, checkedAt: NOW };
    await refreshViewerRoles(input(client, { cached, admit: limit.admit }));
    await refreshViewerRoles(input(client, { outage: { failedAt: NOW }, admit: limit.admit }));
    await refreshViewerRoles(input(client, { grant: null, admit: limit.admit }));
    expect(limit.asked()).toBe(0);
  });

  test("one admitted refresh spends one token, renewals and retries included", async () => {
    const { client } = fakeClient({
      roles: [
        { ok: false, error: "unauthorized" },
        { ok: true, value: FOLLOWER },
      ],
      refresh: [{ ok: true, value: RENEWED }],
    });
    const limit = gate(1);
    expect((await refreshViewerRoles(input(client, { admit: limit.admit }))).kind).toBe("checked");
    expect(limit.asked()).toBe(1);
  });
});
