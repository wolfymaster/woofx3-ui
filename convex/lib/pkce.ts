// RFC 7636 (Proof Key for Code Exchange) helpers. Generic across any OAuth
// integration that uses PKCE — not Spotify-specific. Both functions rely on
// Web Crypto (`crypto.getRandomValues`, `crypto.subtle.digest`) and `btoa`,
// all available in Convex's default httpAction runtime without `"use node"`,
// same as the `crypto.randomUUID()` usage already in http.ts.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A high-entropy random string, 43–128 chars per RFC 7636 (86 chars here). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** `BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`, per RFC 7636 §4.2. */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}
