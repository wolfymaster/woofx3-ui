import type { Doc, Id } from "../_generated/dataModel";
import { newBackend } from "./convexTest.testing";
import { base64UrlEncode } from "./oauthHandoff";
import { type StoredPlatformLinkTokens, sealPlatformLinkTokens } from "./platformLinkTokens";
import { importTokenCipher, PLATFORM_TOKEN_KEY, type TokenCipher } from "./tokenCipher";

// An instance with an owner and Twitch configured, for tests of the functions
// that read and write a platform link's tokens.

export type Backend = ReturnType<typeof newBackend>;

export interface LinkFixture {
  t: Backend;
  instanceId: Id<"instances">;
  ownerId: Id<"users">;
  owner: ReturnType<Backend["withIdentity"]>;
  /** The cipher under the key the backend's functions read from the environment. */
  cipher: TokenCipher;
}

const FAR_FUTURE = 4_000_000_000_000;

export async function linkFixture(): Promise<LinkFixture> {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const keyText = base64UrlEncode(keyBytes);
  process.env[PLATFORM_TOKEN_KEY.envVar] = keyText;
  process.env.AUTH_TWITCH_ID = "twitch-app";
  process.env.AUTH_TWITCH_SECRET = "twitch-secret";

  const t = newBackend();
  const { instanceId, ownerId } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    return { instanceId, ownerId };
  });
  return {
    t,
    instanceId,
    ownerId,
    owner: t.withIdentity({ subject: `${ownerId}|session` }),
    cipher: await importTokenCipher(PLATFORM_TOKEN_KEY, keyText),
  };
}

export interface LinkOptions {
  /** Whether the row holds its tokens in the clear, as rows linked before sealing do. */
  plaintext?: boolean;
  expiresAt?: number;
  accessToken?: string;
  refreshToken?: string;
}

export async function insertTwitchLink(
  f: Pick<LinkFixture, "t" | "instanceId" | "cipher">,
  { plaintext = false, expiresAt = FAR_FUTURE, accessToken = "access-1", refreshToken = "refresh-1" }: LinkOptions = {}
): Promise<Id<"platformLinks">> {
  const tokens: StoredPlatformLinkTokens = plaintext
    ? { accessToken, refreshToken }
    : await sealPlatformLinkTokens(f.cipher, { accessToken, refreshToken });
  return f.t.run((ctx) =>
    ctx.db.insert("platformLinks", {
      instanceId: f.instanceId,
      platform: "twitch",
      platformUserId: "42",
      platformUsername: "wolfy",
      channelId: "42",
      expiresAt,
      scopes: ["chat:read"],
      ...tokens,
    })
  );
}

export function readLink(t: Backend, linkId: Id<"platformLinks">): Promise<Doc<"platformLinks"> | null> {
  return t.run((ctx) => ctx.db.get(linkId));
}
