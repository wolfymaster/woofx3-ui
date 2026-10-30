import type { Doc } from "../_generated/dataModel";
import { PLATFORM_TOKEN_KEY, type TokenCipher, tokenCipherFromEnv } from "./tokenCipher";

// The only code that seals or opens the tokens of a `platformLinks` row.
// Sealing and opening run in actions only; queries and mutations move sealed
// values around without the key.

export interface PlatformLinkTokens {
  accessToken: string;
  refreshToken: string;
}

export type SealedPlatformLinkTokens = Pick<Doc<"platformLinks">, "sealedAccessToken" | "sealedRefreshToken">;

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

/** The link's tokens in the clear. Throws when the sealed pair does not open under the deployment's key. */
export async function openPlatformLinkTokens(
  cipher: TokenCipher,
  link: SealedPlatformLinkTokens
): Promise<PlatformLinkTokens> {
  return {
    accessToken: await cipher.open(link.sealedAccessToken),
    refreshToken: await cipher.open(link.sealedRefreshToken),
  };
}
