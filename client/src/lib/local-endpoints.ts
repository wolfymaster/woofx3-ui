import type { CapabilitySupport } from "@/lib/engine-capabilities";

/** A companion heartbeats every 60 s, so three missed beats reads as offline. */
export const COMPANION_ONLINE_WINDOW_MS = 3 * 60_000;

export function isCompanionOnline(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt !== null && now - lastSeenAt < COMPANION_ONLINE_WINDOW_MS;
}

/**
 * How the engine reaches one of a module's local endpoints, as its settings
 * page explains it. Decided from the module's declaration and the companion's
 * state, so a module needs no flag of its own.
 *
 * - `unsupported`: the engine cannot use the bridge, or this deployment does
 *   not offer it. The settings page shows the plain settings form.
 * - `viaCompanion`: the companion has the endpoint turned on; `address` is
 *   what it dials.
 * - `companionNothingFound`: a confirmed companion, but the endpoint is off
 *   (nothing discovered, or not turned on yet).
 * - `noCompanion`: no companion, or one not yet confirmed on its device.
 */
export type LocalEndpointSituation =
  | { kind: "unsupported" }
  | { kind: "viaCompanion"; deviceName: string; online: boolean; address: string | null }
  | { kind: "companionNothingFound"; deviceName: string; online: boolean }
  | { kind: "noCompanion" };

export interface LocalEndpointSituationInput {
  /** Support for `modules.localEndpoints` on the instance's engine. */
  capability: CapabilitySupport;
  /** Whether this deployment offers the bridge (relay and maintenance API configured). */
  bridgeAvailable: boolean;
  companion: { deviceName: string; lastSeenAt: number | null; confirmed: boolean } | null;
  state: { enabled: boolean; address: { host: string; port: number } | null } | null;
  now: number;
}

/** `host:port`, bracketing an IPv6 literal. */
export function formatEndpointAddress(address: { host: string; port: number }): string {
  const host = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${host}:${address.port}`;
}

export function localEndpointSituation(input: LocalEndpointSituationInput): LocalEndpointSituation {
  if (input.capability !== "supported" || !input.bridgeAvailable) {
    return { kind: "unsupported" };
  }
  const { companion } = input;
  if (!companion?.confirmed) {
    return { kind: "noCompanion" };
  }
  const online = isCompanionOnline(companion.lastSeenAt, input.now);
  if (input.state?.enabled) {
    return {
      kind: "viaCompanion",
      deviceName: companion.deviceName,
      online,
      address: input.state.address ? formatEndpointAddress(input.state.address) : null,
    };
  }
  return { kind: "companionNothingFound", deviceName: companion.deviceName, online };
}

/** Where the companion installer is downloaded from, or null until one is published. */
export function companionDownloadUrl(): string | null {
  const url = import.meta.env.VITE_COMPANION_DOWNLOAD_URL as string | undefined;
  return url?.trim() ? url.trim() : null;
}
