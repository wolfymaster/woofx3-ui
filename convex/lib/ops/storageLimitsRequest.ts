import { HOSTED_STORAGE_LIMIT_FIELDS, type HostedStorageOverride, isByteLimit } from "../hostedStorage";
import type { ParseResult } from "../notifications";

/**
 * An engine's hosted storage override as the backoffice sends it. The body
 * replaces the whole override: a field left out inherits the account's
 * limit, null is unlimited, and `{}` clears the override.
 */
export function parseStorageLimitsRequest(body: unknown): ParseResult<HostedStorageOverride> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(HOSTED_STORAGE_LIMIT_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, message: `Unknown field "${key}"; expected ${HOSTED_STORAGE_LIMIT_FIELDS.join(", ")}` };
    }
  }
  const override: HostedStorageOverride = {};
  for (const field of HOSTED_STORAGE_LIMIT_FIELDS) {
    const value = raw[field];
    if (value === undefined) {
      continue;
    }
    if (!isByteLimit(value)) {
      return { ok: false, message: `${field} must be a whole number of bytes of at least 0, or null for unlimited` };
    }
    override[field] = value;
  }
  return { ok: true, value: override };
}
