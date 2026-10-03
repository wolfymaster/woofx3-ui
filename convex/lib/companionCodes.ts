/**
 * The short code a person reads off the companion and approves in the
 * browser, and the shape of what the companion sends when it pairs.
 *
 * Randomness is passed in to `generateUserCode` so tests can fix it. Callers
 * pass `crypto.getRandomValues` from a Convex action, never from a query or
 * mutation, whose randomness is seeded for determinism.
 */

import { isOpaqueToken, sha256Hex } from "./oauthHandoff";

/** No 0/O, 1/I/L, or vowels: a code reads aloud cleanly and cannot spell a word. */
export const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
export const USER_CODE_LENGTH = 8;

/** Largest multiple of the alphabet size that fits in a byte; bytes at or above it are redrawn. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % USER_CODE_ALPHABET.length);

type FillRandom = (bytes: Uint8Array) => void;

export function generateUserCode(fillRandom: FillRandom): string {
  let code = "";
  const buffer = new Uint8Array(16);
  while (code.length < USER_CODE_LENGTH) {
    fillRandom(buffer);
    for (const byte of Array.from(buffer)) {
      if (byte >= UNBIASED_BYTE_LIMIT) {
        continue;
      }
      code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
      if (code.length === USER_CODE_LENGTH) {
        break;
      }
    }
  }
  return code;
}

/** The stored form of what a person typed or a link carried, or null when it cannot be a code. */
export function normalizeUserCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  if (compact.length !== USER_CODE_LENGTH) {
    return null;
  }
  for (const ch of compact) {
    if (!USER_CODE_ALPHABET.includes(ch)) {
      return null;
    }
  }
  return compact;
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Marks the string as a woofx3 companion token, so a token pasted somewhere it
 * should not be is recognizable to a person or a secret scanner. The companion
 * generates the token itself; must match `TOKEN_PREFIX` in
 * companion/src-tauri/src/credentials.rs.
 */
export const COMPANION_TOKEN_PREFIX = "wfxc_";

export function isCompanionToken(value: string): boolean {
  return value.startsWith(COMPANION_TOKEN_PREFIX) && isOpaqueToken(value.slice(COMPANION_TOKEN_PREFIX.length));
}

/**
 * The only stored form of a companion token: SHA-256 hex of the whole token,
 * prefix included, which is what the companion sends as `tokenHash` when it
 * pairs. Throws on a value that is not a companion token.
 */
export async function hashCompanionToken(token: string): Promise<string> {
  if (!isCompanionToken(token)) {
    throw new Error("hashCompanionToken: not a companion token");
  }
  return sha256Hex(token);
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

/** An installation id is a lowercase UUID the companion generates once per install. */
export function isInstallationId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_DEVICE_NAME_LENGTH = 64;
export const MAX_COMPANION_VERSION_LENGTH = 32;

/** Whether a companion version string is one `start` and `heartbeat` accept, after trimming. */
export function isValidCompanionVersion(version: string): boolean {
  return version.length > 0 && version.length <= MAX_COMPANION_VERSION_LENGTH;
}

/**
 * The bound on companion rows read for one instance. An instance has at most
 * one companion, so more than one row means rows written before that rule;
 * reading a few lets approval sweep them up.
 */
export const MAX_COMPANION_ROWS_PER_INSTANCE = 10;

/**
 * Of an instance's companion rows, those an approval from `installationId`
 * replaces. An instance has at most one companion, so approving a new
 * installation removes every other one; the same installation is updated in
 * place instead, keeping its id.
 */
export function companionsReplacedBy<T extends { installationId: string }>(rows: T[], installationId: string): T[] {
  return rows.filter((row) => row.installationId !== installationId);
}
