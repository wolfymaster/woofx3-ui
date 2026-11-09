/**
 * The shape of what the desktop app sends when it links as an instance's
 * companion, and the rules for its token.
 */

import { isOpaqueToken, sha256Hex } from "./oauthHandoff";

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

export const MAX_DEVICE_NAME_LENGTH = 64;
export const MAX_COMPANION_VERSION_LENGTH = 32;

/** Whether a companion version string is one `start` and `heartbeat` accept, after trimming. */
export function isValidCompanionVersion(version: string): boolean {
  return version.length > 0 && version.length <= MAX_COMPANION_VERSION_LENGTH;
}

/**
 * The bound on companion rows read for one instance. An instance has at most
 * one companion, so more than one row means rows written before that rule;
 * reading a few lets a link sweep them up.
 */
export const MAX_COMPANION_ROWS_PER_INSTANCE = 10;

/**
 * Of an instance's companion rows, those a link from `installationId`
 * replaces. An instance has at most one companion, so linking a new
 * installation removes every other one; the same installation is updated in
 * place instead, keeping its id.
 */
export function companionsReplacedBy<T extends { installationId: string }>(rows: T[], installationId: string): T[] {
  return rows.filter((row) => row.installationId !== installationId);
}
