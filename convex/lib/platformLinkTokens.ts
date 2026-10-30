import type { Doc } from "../_generated/dataModel";
import { PLATFORM_TOKEN_KEY, type TokenCipher, tokenCipherFromEnv } from "./tokenCipher";

// The only code that reads or writes the token fields of a `platformLinks`
// row. Rows are written sealed; a row linked before sealing holds plaintext
// until migrations/sealPlatformLinkTokens converts it, and reads accept either
// shape until then.
//
// Sealing and opening run in actions only. Queries and mutations move sealed
// values around without the key.

export interface PlatformLinkTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SealedPlatformLinkTokens {
  sealedAccessToken: string;
  sealedRefreshToken: string;
}

export type StoredPlatformLinkTokens = Pick<
  Doc<"platformLinks">,
  "sealedAccessToken" | "sealedRefreshToken" | "accessToken" | "refreshToken"
>;

export function platformTokenCipher(): Promise<TokenCipher> {
  return tokenCipherFromEnv(PLATFORM_TOKEN_KEY);
}

export async function sealPlatformLinkTokens(
  cipher: TokenCipher,
  tokens: PlatformLinkTokens
): Promise<SealedPlatformLinkTokens> {
  return {
    sealedAccessToken: await cipher.seal(tokens.accessToken),
    sealedRefreshToken: await cipher.seal(tokens.refreshToken),
  };
}

/** The fields every token write patches onto a link: the sealed pair, with any plaintext pair removed. */
export function storedTokensPatch(sealed: SealedPlatformLinkTokens): Partial<Doc<"platformLinks">> {
  return { ...sealed, accessToken: undefined, refreshToken: undefined };
}

/**
 * The link's tokens in the clear. A sealed pair wins over a plaintext one;
 * throws when the row holds neither pair whole, or the sealed pair does not
 * open under the deployment's key.
 */
export async function openPlatformLinkTokens(
  cipher: TokenCipher,
  link: StoredPlatformLinkTokens
): Promise<PlatformLinkTokens> {
  const sealed = sealedPair(link);
  if (sealed !== null) {
    return {
      accessToken: await cipher.open(sealed.sealedAccessToken),
      refreshToken: await cipher.open(sealed.sealedRefreshToken),
    };
  }
  const plaintext = plaintextPair(link);
  if (plaintext !== null) {
    return plaintext;
  }
  throw new Error("platform link holds no complete token pair");
}

/**
 * The refresh token exactly as stored, sealed or not. A refresh compares it
 * before writing its outcome, so a relink that landed meanwhile is never
 * overwritten (lib/twitchRefresh.ts `refreshOutcomeApplies`).
 */
export function storedRefreshToken(link: StoredPlatformLinkTokens): string {
  const sealed = sealedPair(link);
  if (sealed !== null) {
    return sealed.sealedRefreshToken;
  }
  const plaintext = plaintextPair(link);
  if (plaintext !== null) {
    return plaintext.refreshToken;
  }
  throw new Error("platform link holds no complete token pair");
}

/** Whether the row still holds a token in the clear, which the sealing migration removes. */
export function holdsPlaintextTokens(link: StoredPlatformLinkTokens): boolean {
  return link.accessToken !== undefined || link.refreshToken !== undefined;
}

function sealedPair(link: StoredPlatformLinkTokens): SealedPlatformLinkTokens | null {
  const { sealedAccessToken, sealedRefreshToken } = link;
  if (sealedAccessToken === undefined && sealedRefreshToken === undefined) {
    return null;
  }
  if (sealedAccessToken === undefined || sealedRefreshToken === undefined) {
    throw new Error("platform link holds half a sealed token pair");
  }
  return { sealedAccessToken, sealedRefreshToken };
}

function plaintextPair(link: StoredPlatformLinkTokens): PlatformLinkTokens | null {
  const { accessToken, refreshToken } = link;
  if (accessToken === undefined || refreshToken === undefined) {
    return null;
  }
  return { accessToken, refreshToken };
}
