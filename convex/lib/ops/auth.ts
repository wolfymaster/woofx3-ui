/**
 * Authentication for the ops API, which only the backoffice server calls.
 * The backoffice authenticates its operators itself (Cloudflare Access and
 * its own roles), so this checks only that the caller holds the shared
 * secret and names the operator it acts for.
 */

export const OPS_SECRET_ENV = "OPS_API_SECRET";
/** A second accepted secret, so the secret can rotate without downtime. */
export const OPS_SECRET_NEXT_ENV = "OPS_API_SECRET_NEXT";
export const ACTOR_HEADER = "X-Woofx3-Actor";
export const REASON_HEADER = "X-Woofx3-Reason";

/** 32 random bytes, base64url, is 43 characters. */
const MIN_SECRET_LENGTH = 43;
const MAX_HEADER_LENGTH = 320;

export type OpsAuthResult =
  | { ok: true; actor: string; reason: string | null }
  | { ok: false; status: 400 | 401; code: string; message: string };

/**
 * Checks the bearer secret against the configured ones in constant time,
 * then reads the operator and reason headers. A secret shorter than 32
 * bytes counts as unset: the API never fails open, including on preview
 * deployments where nobody configured it.
 */
export async function authenticateOps(
  headers: Headers,
  configured: readonly (string | undefined)[],
  options: { requireReason: boolean }
): Promise<OpsAuthResult> {
  const secrets = configured.filter((secret): secret is string => (secret?.length ?? 0) >= MIN_SECRET_LENGTH);
  const presented = bearerToken(headers.get("Authorization"));
  let matched = false;
  for (const secret of secrets) {
    // Every configured secret is compared, so timing does not say which one matched.
    if (presented !== null && (await constantTimeEqual(presented, secret))) {
      matched = true;
    }
  }
  if (!matched) {
    return { ok: false, status: 401, code: "unauthorized", message: "Unauthorized" };
  }

  const actor = headers.get(ACTOR_HEADER)?.trim() ?? "";
  if (actor === "" || actor.length > MAX_HEADER_LENGTH) {
    return { ok: false, status: 400, code: "actor_required", message: `${ACTOR_HEADER} must name the operator` };
  }
  const reason = headers.get(REASON_HEADER)?.trim() ?? "";
  if (reason.length > MAX_HEADER_LENGTH) {
    return { ok: false, status: 400, code: "reason_too_long", message: `${REASON_HEADER} is too long` };
  }
  if (options.requireReason && reason === "") {
    return { ok: false, status: 400, code: "reason_required", message: `${REASON_HEADER} must say why` };
  }
  return { ok: true, actor, reason: reason === "" ? null : reason };
}

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer (\S+)$/);
  return match ? (match[1] ?? null) : null;
}

/** Compares SHA-256 digests, so neither the length nor the contents of the secret leak through timing. */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return difference === 0;
}
