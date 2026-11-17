/**
 * Authentication for the ops API. Each caller (see callers.ts) holds its own
 * secret and may use only its own routes. The caller authenticates its
 * operators itself (the backoffice with Cloudflare Access and its roles), so
 * this checks that a secret matches, names the caller it belongs to, and
 * reads the operator the caller acts for.
 */

import { secretsEqual } from "../secretCompare";
import type { OpsCaller } from "./callers";

export const ACTOR_HEADER = "X-Woofx3-Actor";
export const REASON_HEADER = "X-Woofx3-Reason";

/**
 * 32 random bytes, base64url, is 43 characters. Must match MIN_OPS_SECRET_LENGTH
 * in woofx3-maintenance (src/billing/config.ts), which the maintenance tests pin.
 */
export const MIN_OPS_SECRET_LENGTH = 43;
const MAX_HEADER_LENGTH = 320;
const MAX_REASON_LENGTH = 500;

export type OpsAuthResult =
  | { ok: true; caller: OpsCaller; actor: string; reason: string | null }
  | { ok: false; status: 400 | 401; code: string; message: string };

/** A caller with the secrets configured for it (current and next); a missing or short one counts as unset. */
export interface ConfiguredCaller {
  caller: OpsCaller;
  secrets: readonly (string | undefined)[];
}

/**
 * Checks the bearer secret against every configured secret in constant time
 * and answers with the caller that holds it (the first in list order when
 * two callers share a value), then reads the operator and reason headers.
 * A secret shorter than MIN_OPS_SECRET_LENGTH counts as unset: the API never
 * fails open, including on preview deployments where nobody configured it.
 */
export async function authenticateOps(
  headers: Headers,
  configured: readonly ConfiguredCaller[],
  options: { requireReason: boolean }
): Promise<OpsAuthResult> {
  const presented = bearerToken(headers.get("Authorization"));
  let caller: OpsCaller | null = null;
  for (const entry of configured) {
    for (const secret of entry.secrets) {
      if (secret === undefined || secret.length < MIN_OPS_SECRET_LENGTH) {
        continue;
      }
      // Every configured secret is compared, so timing does not say which one matched.
      if (presented !== null && (await secretsEqual(presented, secret)) && caller === null) {
        caller = entry.caller;
      }
    }
  }
  if (caller === null) {
    return { ok: false, status: 401, code: "unauthorized", message: "Unauthorized" };
  }

  const actor = headers.get(ACTOR_HEADER)?.trim() ?? "";
  if (actor === "" || actor.length > MAX_HEADER_LENGTH) {
    return { ok: false, status: 400, code: "actor_required", message: `${ACTOR_HEADER} must name the operator` };
  }
  // Header values are Latin-1, so a reason arrives as percent-encoded UTF-8,
  // as the maintenance API also expects it.
  let reason: string;
  try {
    reason = decodeURIComponent(headers.get(REASON_HEADER) ?? "").trim();
  } catch {
    return {
      ok: false,
      status: 400,
      code: "invalid_reason",
      message: `${REASON_HEADER} must be percent-encoded UTF-8`,
    };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, status: 400, code: "reason_too_long", message: `${REASON_HEADER} is too long` };
  }
  if (options.requireReason && reason === "") {
    return { ok: false, status: 400, code: "reason_required", message: `${REASON_HEADER} must say why` };
  }
  return { ok: true, caller, actor, reason: reason === "" ? null : reason };
}

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match ? (match[1] ?? null) : null;
}
