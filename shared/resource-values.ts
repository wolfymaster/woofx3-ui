/**
 * The storage key every resource kind keeps an instance's value under, in the
 * owning module's storage: `state:<canonicalId>`. A storage change under any
 * other key is not a resource value. Must match the engine's convention
 * (`getResourceValues` in woofx3 shared/clients/typescript/api/api.ts).
 */
export const RESOURCE_VALUE_KEY_PREFIX = "state:";

/** The canonical id a storage key holds the value of, or null for any other key. */
export function canonicalIdForStorageKey(key: string): string | null {
  if (!key.startsWith(RESOURCE_VALUE_KEY_PREFIX)) {
    return null;
  }
  const canonicalId = key.slice(RESOURCE_VALUE_KEY_PREFIX.length);
  return canonicalId.length > 0 ? canonicalId : null;
}
