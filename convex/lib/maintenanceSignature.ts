/**
 * Signature checking for woofx3 maintenance API callbacks.
 *
 * Ported from the maintenance API's own `src/callbacks/sign.ts`, which is the
 * reference implementation — header format, tolerance and the multiple-`v1`
 * rule must keep matching it or callbacks stop verifying. The one difference
 * is mechanical: Convex's runtime has Web Crypto rather than node:crypto, so
 * the HMAC is async and the constant-time compare is done by hand.
 *
 * `t` is inside the MAC, so a captured callback cannot be replayed later with
 * a fresh timestamp; rejecting a timestamp outside the tolerance is what makes
 * the capture window short.
 */

export const SIGNATURE_HEADER = "X-Woofx3-Signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type Verification = { valid: true; timestamp: number } | { valid: false; reason: string };

async function hmacHex(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent, so it cannot leak how far two hex strings agree. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Whether `header` (`t=<unix seconds>,v1=<hex>`) signs `body` with `secret`.
 *
 * Several `v1` entries are accepted so the sender can rotate a secret by
 * signing with both; any one matching is enough.
 */
export async function verifySignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  now: Date
): Promise<Verification> {
  if (!header) {
    return { valid: false, reason: "missing signature" };
  }
  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
    } else if (key === "v1" && /^[0-9a-f]{64}$/.test(value)) {
      candidates.push(value);
    }
  }
  if (timestamp === null || candidates.length === 0) {
    return { valid: false, reason: "malformed signature" };
  }
  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (age > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp outside tolerance" };
  }
  const expected = await hmacHex(secret, timestamp, body);
  const matches = candidates.some((candidate) => equalsConstantTime(candidate, expected));
  return matches ? { valid: true, timestamp } : { valid: false, reason: "signature mismatch" };
}
