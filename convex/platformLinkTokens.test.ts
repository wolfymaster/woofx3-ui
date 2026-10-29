import { afterEach, describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import { generateOpaqueToken, hashOpaqueToken } from "./lib/oauthHandoff";
import { insertTwitchLink, linkFixture, readLink } from "./lib/platformLinks.fixtures";

// The functions that hand a streamer's Twitch token to its callers: each
// returns the token in the clear, whichever shape the row stores it in, and
// none returns or leaves behind anything else.

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
});

/** Answers Twitch's token endpoint with a renewed grant, and records the refresh token it was sent. */
function twitchRenews(renewed: { access_token: string; refresh_token: string }): string[] {
  const sentRefreshTokens: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentRefreshTokens.push(new URLSearchParams(String(init?.body)).get("refresh_token") ?? "");
    return new Response(JSON.stringify({ ...renewed, expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  return sentRefreshTokens;
}

function expectNoTokenIn(value: unknown, ...tokens: string[]): void {
  const text = JSON.stringify(value);
  for (const token of tokens) {
    expect(text).not.toContain(token);
  }
}

describe("ensureFreshTwitchToken", () => {
  test("opens a sealed link's token", async () => {
    const f = await linkFixture();
    await insertTwitchLink(f);
    const token = await f.t.action(internal.platformRealtime.ensureFreshTwitchToken, { instanceId: f.instanceId });
    expect(token?.accessToken).toBe("access-1");
  });

  test("reads a link not sealed yet", async () => {
    const f = await linkFixture();
    await insertTwitchLink(f, { plaintext: true });
    const token = await f.t.action(internal.platformRealtime.ensureFreshTwitchToken, { instanceId: f.instanceId });
    expect(token?.accessToken).toBe("access-1");
  });

  for (const plaintext of [false, true]) {
    test(`renews a ${plaintext ? "plaintext" : "sealed"} link and stores the renewed grant sealed`, async () => {
      const f = await linkFixture();
      const linkId = await insertTwitchLink(f, { plaintext, expiresAt: Date.now() });
      const sent = twitchRenews({ access_token: "access-2", refresh_token: "refresh-2" });

      const token = await f.t.action(internal.platformRealtime.ensureFreshTwitchToken, { instanceId: f.instanceId });

      expect(sent).toEqual(["refresh-1"]);
      expect(token?.accessToken).toBe("access-2");
      const row = await readLink(f.t, linkId);
      expect(row?.accessToken).toBeUndefined();
      expect(row?.refreshToken).toBeUndefined();
      expectNoTokenIn(row, "access-2", "refresh-2");
      expect(await f.cipher.open(row?.sealedAccessToken ?? "")).toBe("access-2");
      expect(await f.cipher.open(row?.sealedRefreshToken ?? "")).toBe("refresh-2");
    });
  }

  test("refuses a link sealed under another key rather than handing out garbage", async () => {
    const f = await linkFixture();
    await insertTwitchLink(f);
    await linkFixture();
    await expect(
      f.t.action(internal.platformRealtime.ensureFreshTwitchToken, { instanceId: f.instanceId })
    ).rejects.toThrow();
  });
});

describe("grantTokenToEngine", () => {
  test("hands the engine the access token in the clear, and never the refresh token", async () => {
    const f = await linkFixture();
    await insertTwitchLink(f);
    const answer = await f.t.action(internal.twitchIntegration.grantTokenToEngine, { instanceId: f.instanceId });
    expect(answer.token?.accessToken).toBe("access-1");
    expectNoTokenIn(answer, "refresh-1", "p1.");
  });
});

describe("getPlatformLinks", () => {
  for (const plaintext of [false, true]) {
    test(`returns no token field from a ${plaintext ? "plaintext" : "sealed"} link`, async () => {
      const f = await linkFixture();
      await insertTwitchLink(f, { plaintext });
      const rows = await f.owner.query(api.instances.getPlatformLinks, { instanceId: f.instanceId });
      expect(rows).toHaveLength(1);
      for (const key of ["accessToken", "refreshToken", "sealedAccessToken", "sealedRefreshToken"]) {
        expect(key in rows[0]).toBe(false);
      }
      expectNoTokenIn(rows, "access-1", "refresh-1", "p1.");
    });
  }
});

describe("completeConnect", () => {
  async function storeHandoff(
    f: Awaited<ReturnType<typeof linkFixture>>,
    code: string,
    tokens: Record<string, string>
  ): Promise<void> {
    await f.t.run(async (ctx) => {
      await ctx.db.insert("oauthConnectHandoffs", {
        codeHash: await hashOpaqueToken(code),
        provider: "twitch",
        userId: f.ownerId,
        instanceId: f.instanceId,
        redirectTo: "/admin/integrations",
        twitch: {
          platformUserId: "42",
          platformUsername: "wolfy",
          expiresAt: 4_000_000_000_000,
          scopes: ["chat:read"],
          ...tokens,
        },
        createdAt: Date.now(),
      });
    });
  }

  test("writes the sealed grant over a plaintext link and clears the plaintext", async () => {
    const f = await linkFixture();
    const linkId = await insertTwitchLink(f, { plaintext: true });
    const code = generateOpaqueToken();
    await storeHandoff(f, code, {
      sealedAccessToken: await f.cipher.seal("access-9"),
      sealedRefreshToken: await f.cipher.seal("refresh-9"),
    });

    const result = await f.t.mutation(internal.twitchIntegration.completeConnect, {
      codeHash: await hashOpaqueToken(code),
      userId: f.ownerId,
    });

    expect(result.ok).toBe(true);
    const row = await readLink(f.t, linkId);
    expect(row?.accessToken).toBeUndefined();
    expect(row?.refreshToken).toBeUndefined();
    expect(await f.cipher.open(row?.sealedAccessToken ?? "")).toBe("access-9");
  });

  test("refuses a handoff stored with plaintext tokens", async () => {
    const f = await linkFixture();
    const code = generateOpaqueToken();
    await storeHandoff(f, code, { accessToken: "access-9", refreshToken: "refresh-9" });
    const result = await f.t.mutation(internal.twitchIntegration.completeConnect, {
      codeHash: await hashOpaqueToken(code),
      userId: f.ownerId,
    });
    expect(result).toEqual({ ok: false, error: "connect_code_invalid" });
    expect(await f.t.run((ctx) => ctx.db.query("platformLinks").take(1))).toEqual([]);
  });
});
