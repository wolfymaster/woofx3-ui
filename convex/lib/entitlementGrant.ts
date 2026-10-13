import { type FeatureFlagRow, type FeatureFlagSubject, isFlagOn } from "./featureFlags";
import { base64UrlEncode } from "./oauthHandoff";

/**
 * Entitlement grants: which gateable engine features a managed engine may
 * use. Convex decides from operator targeting (`engineEntitlements` rows,
 * evaluated like feature flags) and signs the answer; the engine enforces it.
 *
 * The token must be exactly what woofx3 api/src/entitlement-grant.ts
 * verifies; the format is documented in woofx3
 * docs/services/engine-entitlements.md.
 */

export const ENTITLEMENT_GRANT_TYPE = "woofx3-entitlements+jwt";

/** How long a grant counts. A missed renewal is bounded by this. */
export const GRANT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Grants are renewed this long after they are pushed, well inside their lifetime. */
export const GRANT_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** A push that failed is tried again after this long. */
export const GRANT_RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * How long a scheduled push holds its row before the renewal sweep may pick it
 * again, so a push still running is not doubled.
 */
export const GRANT_PUSH_LEASE_MS = 15 * 60 * 1000;

/**
 * Whether this deployment signs grants. Without a key (a dev deployment with
 * no managed engines) no grant rows are made, so nothing is scheduled for
 * pushes that could never be signed. The key itself is parsed only where it
 * signs, in a Node action.
 */
export function isGrantSigningConfigured(): boolean {
  return Boolean(process.env.ENTITLEMENT_SIGNING_KEY && process.env.ENTITLEMENT_SIGNING_KEY_ID);
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function isCapabilityId(id: string): boolean {
  return CAPABILITY_ID_PATTERN.test(id);
}

export interface EntitlementGrantPayload {
  aud: string;
  iat: number;
  exp: number;
  seq: number;
  grants: string[];
  limits: Record<string, number>;
}

/**
 * The name a managed engine runs under (`WOOFX3_ENGINE_NAME`), which a grant
 * is addressed to. Must match `serviceNameFor` in woofx3-maintenance
 * src/engines/naming.ts: `eng-` and the first 8 hex digits of the engine id.
 */
export function engineNameFor(maintenanceEngineId: string): string {
  const shortId = maintenanceEngineId.replaceAll("-", "").slice(0, 8);
  if (!/^[0-9a-f]{8}$/.test(shortId)) {
    throw new Error(`Maintenance engine id ${maintenanceEngineId} does not yield an 8-hex-digit short id`);
  }
  return `eng-${shortId}`;
}

/** An `engineEntitlements` row: operator targeting for one gateable capability. */
export interface EngineEntitlementRow {
  capability: string;
  state: FeatureFlagRow["state"];
  rules?: FeatureFlagRow["rules"];
}

/** The capabilities an engine is granted, sorted. A capability with no row is not granted. */
export function grantedCapabilities(rows: readonly EngineEntitlementRow[], subject: FeatureFlagSubject): string[] {
  return rows
    .filter((row) => isFlagOn({ key: row.capability, state: row.state, rules: row.rules }, subject))
    .map((row) => row.capability)
    .sort();
}

/**
 * Why a capability is withheld, for the dashboard's wording: a plan the
 * account lacks, or a rollout the engine is not in yet.
 */
export function withheldReason(row: EngineEntitlementRow | null): "plan" | "rollout" {
  return row?.rules?.licenseFeature !== undefined ? "plan" : "rollout";
}

/**
 * The next grant's sequence number. Wall-clock milliseconds keep it rising
 * even if the grant table were lost, so a rebuilt Convex never issues a seq
 * the engine already holds a higher one than; `previous + 1` keeps it rising
 * when the clock does not.
 */
export function nextGrantSeq(previous: number | undefined, nowMs: number): number {
  return Math.max((previous ?? 0) + 1, Math.floor(nowMs));
}

export function grantPayload(input: {
  engineName: string;
  seq: number;
  grants: string[];
  nowMs: number;
}): EntitlementGrantPayload {
  const iat = Math.floor(input.nowMs / 1000);
  return {
    aud: input.engineName,
    iat,
    exp: iat + GRANT_LIFETIME_MS / 1000,
    seq: input.seq,
    grants: input.grants,
    limits: {},
  };
}

/** `base64url(header).base64url(payload)`: the bytes the signature covers. */
export function grantSigningInput(keyId: string, payload: EntitlementGrantPayload): string {
  const header = { alg: "EdDSA", kid: keyId, typ: ENTITLEMENT_GRANT_TYPE };
  return `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** True for capnweb's refusal of a method an engine older than entitlements does not expose. */
export function isLegacyGrantError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes("'setEntitlementGrant' is not a function");
}
