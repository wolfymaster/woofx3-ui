/**
 * Convex rejects object field names starting with `$` as reserved. The engine
 * embeds JSON-Schema-style keys such as `$ref` on workflow triggers and tasks.
 * Escape at every Convex write boundary; unescape before engine RPC and UI use.
 */
export const CONVEX_DOLLAR_KEY_PREFIX = "__$";

export function escapeDollarKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(escapeDollarKeys);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const key =
        k.startsWith("$") && !k.startsWith(CONVEX_DOLLAR_KEY_PREFIX) ? `${CONVEX_DOLLAR_KEY_PREFIX}${k.slice(1)}` : k;
      out[key] = escapeDollarKeys(v);
    }
    return out;
  }
  return value;
}

export function unescapeDollarKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unescapeDollarKeys);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const key = k.startsWith(CONVEX_DOLLAR_KEY_PREFIX) ? `$${k.slice(CONVEX_DOLLAR_KEY_PREFIX.length)}` : k;
      out[key] = unescapeDollarKeys(v);
    }
    return out;
  }
  return value;
}
