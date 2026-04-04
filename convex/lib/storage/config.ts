import type { StorageProvider } from "./types";

/**
 * Resolve the active storage provider.
 * Per-instance setting takes precedence over the global STORAGE_PROVIDER env var.
 * Falls back to "convex" so existing deployments require zero configuration.
 */
export function resolveProvider(instanceOverride?: StorageProvider | null): StorageProvider {
  if (instanceOverride) return instanceOverride;
  const env = process.env.STORAGE_PROVIDER as StorageProvider | undefined;
  return env ?? "convex";
}
