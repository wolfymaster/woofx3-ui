import type { RpcTarget } from "@woofx3/api/client";

/**
 * The engine's half of the companion bridge (capability
 * `modules.localEndpoints`). Declared here because the engine checkout this
 * repo builds against may predate it; retire these as the shared surface
 * catches up. Must match `RelayConfig` and `setRelayConfig` in woofx3
 * `shared/clients/typescript/api/api.ts`, and `EngineRequestType.RELAY_CREDENTIAL_REQUESTED`
 * and `RelayCredentialRequestedResponse` in `shared/clients/typescript/api/webhooks.ts`.
 */

/** Where a cloud engine reaches the companion's bridge, and which endpoints go through it. */
export interface RelayConfig {
  /** `https://c-xxxxxxxxxxxx.woofx3.tv`; the engine opens `wss://…/bridge/<moduleId>/<endpointId>`. */
  bridgeOrigin: string;
  endpoints: { moduleId: string; endpointId: string }[];
}

export interface RelayEngineApi extends RpcTarget {
  /** Route the listed endpoints through the companion's bridge, or stop (null). The engine stores it. */
  setRelayConfig(config: RelayConfig | null): Promise<{ ok: true }>;
}

/** The callback an engine sends when it needs a bridge credential; it waits for the answer in the response body. */
export const RELAY_CREDENTIAL_REQUESTED_EVENT_TYPE = "relay.credential.requested";

/**
 * A short-lived bridge credential with the configuration it is valid for.
 * `relay: null` means the instance routes nothing through a companion, and
 * the engine clears its relay configuration. `expiresAt` is milliseconds
 * since the epoch.
 */
export type RelayCredentialRequestedResponse =
  | { relay: RelayConfig & { credential: string; expiresAt: number } }
  | { relay: null };

/**
 * The hostname the maintenance API allocates for an instance's bridge:
 * `c-` and twelve lowercase base32 characters, under whatever domain that
 * deployment serves (`PUBLIC_BASE_DOMAIN`), so the domain is not checked.
 */
const COMPANION_HOSTNAME_PATTERN = /^c-[a-z2-7]{12}(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_HOSTNAME_CHARS = 253;

export function isCompanionHostname(hostname: string): boolean {
  return hostname.length <= MAX_HOSTNAME_CHARS && COMPANION_HOSTNAME_PATTERN.test(hostname);
}

export function bridgeOrigin(hostname: string): string {
  return `https://${hostname}`;
}
