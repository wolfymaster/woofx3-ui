import { logger } from "../logger";

/**
 * Cloudflare Turnstile, which anonymous form submissions must pass. Signed-in
 * viewers have an identity to rate limit and skip it. Everything here fails
 * closed: no secret, no answer from Cloudflare or a refusal all keep the
 * submission out.
 */

export const TURNSTILE_SECRET_ENV = "TURNSTILE_SECRET_KEY";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_TIMEOUT_MS = 5_000;
/** Cloudflare's documented longest token. */
const MAX_TOKEN_LENGTH = 2048;

/** Codes meaning this deployment or Cloudflare is at fault, not the visitor. */
const NOT_THE_VISITOR = new Set(["missing-input-secret", "invalid-input-secret", "internal-error"]);

export type TurnstileVerdict = "passed" | "refused" | "unavailable";

/** The configured secret, or null when anonymous submissions cannot be verified. */
export function turnstileSecret(env: Record<string, string | undefined>): string | null {
  const secret = env[TURNSTILE_SECRET_ENV]?.trim() ?? "";
  return secret === "" ? null : secret;
}

export async function verifyTurnstile(secret: string, token: string | null): Promise<TurnstileVerdict> {
  if (token === null || token === "" || token.length > MAX_TOKEN_LENGTH) {
    return "refused";
  }
  let body: { success?: unknown; "error-codes"?: unknown };
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    body = (await response.json()) as typeof body;
  } catch (error: unknown) {
    logger.warn("turnstile: siteverify did not answer", { error: String(error) });
    return "unavailable";
  }
  if (body.success === true) {
    return "passed";
  }
  const codes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];
  if (codes.some((code) => NOT_THE_VISITOR.has(String(code)))) {
    logger.error("turnstile: siteverify refused for a reason other than the visitor", { codes });
    return "unavailable";
  }
  return "refused";
}
