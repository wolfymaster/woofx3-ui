import type { StorageConfig } from "@woofx3/api";
import { v } from "convex/values";
import type { Entitlements } from "./entitlements";

/**
 * Hosted storage is the bucket maintenance provisions for a managed engine,
 * which we pay for. Its plan limits (`storage.hostedAssetBytes`,
 * `storage.hostedFileBytes`) are enforced here and never in the engine: a
 * self-hosted engine, or a managed one whose admin has moved it onto storage
 * of their own, has no limit.
 *
 * Maintenance hands the engine its bucket and credentials as environment
 * variables. The engine's storage settings override those field by field, and
 * `getStorageConfig` reports only the settings. So a managed engine is off
 * hosted storage only when its settings name a bucket and both credentials:
 * any field left unset falls back to the provisioned one, and the provisioned
 * credentials are never shown to anyone, so settings that write anywhere but
 * our bucket must carry credentials of their own. A Convex-side record of
 * "storage was changed" would miss exactly that partial override, which still
 * writes into our bucket. A file backend on a managed engine is its volume,
 * which we also host, so it counts as hosted too.
 */
export function isOnHostedStorage(hosting: "managed" | "external" | undefined, config: StorageConfig): boolean {
  if (hosting !== "managed") {
    return false;
  }
  const ownBucket =
    config.provider === "s3" && Boolean(config.bucket) && Boolean(config.accessKey) && Boolean(config.secretKey);
  return !ownBucket;
}

export interface HostedStorageLimits {
  /** Null is unlimited. */
  totalBytes: number | null;
  /** Null is unlimited. */
  fileBytes: number | null;
}

/**
 * An engine's own limits, which an operator sets on one instance and which
 * win over its account's entitlements. A field left out inherits the
 * account's value; null is unlimited. Usage is counted per engine, so the
 * limit can be too, while every other entitlement stays the account's.
 */
export interface HostedStorageOverride {
  totalBytes?: number | null;
  fileBytes?: number | null;
}

export const hostedStorageOverrideValidator = v.object({
  totalBytes: v.optional(v.union(v.number(), v.null())),
  fileBytes: v.optional(v.union(v.number(), v.null())),
});

/** The limits that apply to one engine: its override where it sets one, otherwise the account's entitlements. */
export function hostedStorageLimits(
  entitlements: Entitlements,
  override: HostedStorageOverride = {}
): HostedStorageLimits {
  const totalBytes = entitlements.limits["storage.hostedAssetBytes"];
  const fileBytes = entitlements.limits["storage.hostedFileBytes"];
  if (totalBytes === undefined || fileBytes === undefined) {
    throw new Error("Hosted storage limits were not resolved");
  }
  return {
    totalBytes: override.totalBytes === undefined ? totalBytes : override.totalBytes,
    fileBytes: override.fileBytes === undefined ? fileBytes : override.fileBytes,
  };
}

/** Whether a value is a limit an operator could mean: a whole number of bytes of at least 0, or null for unlimited. */
export function isByteLimit(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/**
 * Why an upload of `size` bytes is refused, or null when it fits. `usedBytes`
 * is everything already stored or promised: the engine's own total plus the
 * reservations it may not include yet.
 */
export function hostedUploadRefusal(limits: HostedStorageLimits, usedBytes: number, size: number): string | null {
  if (limits.fileBytes !== null && size > limits.fileBytes) {
    return `This file is ${formatStorageBytes(size)}; this engine allows uploads of up to ${formatStorageBytes(limits.fileBytes)} each.`;
  }
  if (limits.totalBytes !== null && usedBytes + size > limits.totalBytes) {
    const left = Math.max(0, limits.totalBytes - usedBytes);
    return `Uploading this would exceed this engine's ${formatStorageBytes(limits.totalBytes)} of asset storage (${formatStorageBytes(left)} left). Delete assets you no longer need to make room.`;
  }
  return null;
}

/** A byte count for people, in binary units: `512 B`, `28 KB`, `1.4 MB`, `1 GB`. */
export function formatStorageBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
