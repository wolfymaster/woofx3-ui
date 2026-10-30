/**
 * The gate on the viewer sign-in start route. Convex HTTP actions never see
 * the client's address, so sign-in is limited per address at the Cloudflare
 * edge (woofx3-maintenance `worker/src/viewer-sign-in.ts`), which forwards
 * every start within its limit with this shared secret. Requiring it here is
 * what keeps the limit from being skipped by calling this deployment directly.
 * The deployment-wide `viewerLoginStart` bucket stays behind it as a ceiling.
 *
 * The gate never fails open: a deployment without a usable secret refuses
 * every start, previews included.
 */

import { secretsEqual } from "./secretCompare";

/** Must match `edgeSecretHeader` in woofx3-maintenance worker/src/viewer-sign-in.ts. */
export const EDGE_SECRET_HEADER = "X-Woofx3-Edge-Secret";
export const EDGE_SECRET_ENV = "VIEWER_SIGN_IN_EDGE_SECRET";
/** A second accepted secret, so the secret can rotate without refusing sign-ins. */
export const EDGE_SECRET_NEXT_ENV = "VIEWER_SIGN_IN_EDGE_SECRET_NEXT";

/** 32 random bytes, base64url, is 43 characters; the edge refuses anything shorter too. */
const MIN_SECRET_LENGTH = 43;

type Env = Record<string, string | undefined>;

export type EdgeGateVerdict =
  | { ok: true }
  | { ok: false; refusal: "not_configured"; problem: string }
  | { ok: false; refusal: "not_from_edge" };

/** The accepted secrets, or why the deployment cannot accept any. */
export function edgeSecretsFromEnv(env: Env): { ok: true; secrets: string[] } | { ok: false; problem: string } {
  const current = env[EDGE_SECRET_ENV] ?? "";
  if (current.length < MIN_SECRET_LENGTH) {
    return { ok: false, problem: `${EDGE_SECRET_ENV} is unset or shorter than ${MIN_SECRET_LENGTH} characters` };
  }
  const next = env[EDGE_SECRET_NEXT_ENV] ?? "";
  if (next === "") {
    return { ok: true, secrets: [current] };
  }
  if (next.length < MIN_SECRET_LENGTH) {
    return { ok: false, problem: `${EDGE_SECRET_NEXT_ENV} is shorter than ${MIN_SECRET_LENGTH} characters` };
  }
  return { ok: true, secrets: [current, next] };
}

/** Whether a start request came through the edge, checked in constant time against every accepted secret. */
export async function checkEdgeGate(headers: Headers, env: Env): Promise<EdgeGateVerdict> {
  const configured = edgeSecretsFromEnv(env);
  if (!configured.ok) {
    return { ok: false, refusal: "not_configured", problem: configured.problem };
  }
  const presented = headers.get(EDGE_SECRET_HEADER);
  let matched = false;
  for (const secret of configured.secrets) {
    // Every accepted secret is compared, so timing does not say which one matched.
    if (presented !== null && (await secretsEqual(presented, secret))) {
      matched = true;
    }
  }
  return matched ? { ok: true } : { ok: false, refusal: "not_from_edge" };
}
