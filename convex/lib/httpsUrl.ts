export type HttpsUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/**
 * A URL the browser may be sent to: absolute https, no embedded credentials.
 * Anything else (javascript:, data:, protocol-relative, http:) would let a
 * misbehaving upstream run script or phish in this origin.
 */
export function parseHttpsUrl(input: unknown): HttpsUrlResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "not a string" };
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "not an absolute URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `scheme ${parsed.protocol} is not https:` };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "carries credentials" };
  }
  return { ok: true, url: input };
}
