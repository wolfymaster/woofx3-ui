/**
 * Whether a presented secret equals a configured one, comparing SHA-256
 * digests so neither the secret's length nor how much of it matched leaks
 * through timing. Convex's runtime has Web Crypto but no `timingSafeEqual`,
 * so the byte comparison is done by hand.
 */
export async function secretsEqual(presented: string, configured: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) {
    difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return difference === 0;
}
