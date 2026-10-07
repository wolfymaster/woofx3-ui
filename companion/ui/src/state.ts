import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Where pairing stands. Must match `CompanionState` in
 * companion/src-tauri/src/state.rs (serde tag = "kind").
 * `expiresAt` is milliseconds since the epoch on this PC's clock.
 */
export type CompanionState =
  | { kind: "starting" }
  | { kind: "offline" }
  | { kind: "unpaired" }
  | { kind: "pairing"; userCode: string; verificationUrl: string; expiresAt: number }
  | { kind: "confirmPairing"; instanceName: string; approvedBy: string }
  | { kind: "paired"; instanceName: string; cloudConnected: boolean }
  | { kind: "error"; message: string };

/** A newer release, downloaded and verified. Must match `ReadyUpdate` in companion/src-tauri/src/state.rs. */
export type ReadyUpdate = { version: string };

/**
 * What the Rust process says the window should show: where pairing stands,
 * plus the update waiting to be installed. Must match `WindowState` in
 * companion/src-tauri/src/state.rs, which puts the pairing state's fields next
 * to `update`.
 */
export type WindowState = CompanionState & { update: ReadyUpdate | null };

/** Must match `STATE_EVENT` in companion/src-tauri/src/state.rs. */
export const STATE_EVENT = "companion://state";

export async function currentState(): Promise<WindowState> {
  return invoke<WindowState>("get_state");
}

export function onStateChange(handler: (state: WindowState) => void): Promise<() => void> {
  return listen<WindowState>(STATE_EVENT, (event) => handler(event.payload));
}

/** Must match `INTEGRATIONS_EVENT` in companion/src-tauri/src/state.rs. */
export const INTEGRATIONS_EVENT = "companion://integrations";

/** Must match `Availability` in companion/src-tauri/src/state.rs. */
export type Availability =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

/**
 * The companion's connection to the relay. Must match `RelayView` in
 * companion/src-tauri/src/state.rs. `retryAt` is milliseconds since the epoch
 * on this PC's clock.
 */
export type RelayView =
  | { kind: "notNeeded" }
  | { kind: "unavailable" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "retrying"; retryAt: number; error: string }
  | { kind: "displaced" }
  | { kind: "refused" };

/** Must match `DiscoveryView` in companion/src-tauri/src/state.rs. */
export type DiscoveryView =
  | { kind: "manual" }
  | { kind: "unsupported" }
  | { kind: "notPermitted" }
  | { kind: "searching" }
  | { kind: "notFound" }
  | { kind: "serverOff"; port: number }
  | { kind: "found"; port: number; hasPassword: boolean }
  | { kind: "unreadable" };

/** Must match `AddressView` in companion/src-tauri/src/state.rs. */
export type AddressView = { display: string; origin: "discovered" | "confirmed" };

/** Must match `EndpointView` in companion/src-tauri/src/state.rs. */
export type EndpointView = {
  id: string;
  name: string;
  bridgeable: boolean;
  /** The built-in discoverer serving this endpoint, when one does. */
  discoverer: string | null;
  discovery: DiscoveryView;
  address: AddressView | null;
  enabled: boolean;
  sharePassword: boolean;
  canSharePassword: boolean;
  passwordSetByHand: boolean;
  reportError: string | null;
};

/** Must match `ModuleView` in companion/src-tauri/src/state.rs. */
export type ModuleView = { moduleId: string; moduleName: string; endpoints: EndpointView[] };

/** Must match `IntegrationsView` in companion/src-tauri/src/state.rs. */
export type IntegrationsView = {
  availability: Availability;
  relayAvailable: boolean;
  relay: RelayView;
  modules: ModuleView[];
};

/** Must match `TestResult` in companion/src-tauri/src/state.rs. */
export type TestResult =
  | { kind: "ok"; protocol: string | null }
  | { kind: "refused"; reason: string }
  | { kind: "timedOut" };

export async function currentIntegrations(): Promise<IntegrationsView> {
  return invoke<IntegrationsView>("get_integrations");
}

export function onIntegrationsChange(handler: (view: IntegrationsView) => void): Promise<() => void> {
  return listen<IntegrationsView>(INTEGRATIONS_EVENT, (event) => handler(event.payload));
}

/** Must match the commands registered in companion/src-tauri/src/lib.rs. */
export const commands = {
  startPairing: () => invoke<void>("start_pairing"),
  cancelPairing: () => invoke<void>("cancel_pairing"),
  openVerificationUrl: () => invoke<void>("open_verification_url"),
  confirmPairing: () => invoke<void>("confirm_pairing"),
  rejectPairing: () => invoke<void>("reject_pairing"),
  unpair: () => invoke<void>("unpair"),
  /** Settles only if installing fails: on success the companion restarts. */
  installUpdate: () => invoke<void>("install_update"),
  setEndpointEnabled: (moduleId: string, endpointId: string, enabled: boolean) =>
    invoke<void>("set_endpoint_enabled", { moduleId, endpointId, enabled }),
  confirmAddress: (moduleId: string, endpointId: string, address: string) =>
    invoke<void>("confirm_address", { moduleId, endpointId, address }),
  // Not `useDiscovered`, which lint rules would take for a React hook.
  chooseDiscovered: (moduleId: string, endpointId: string) => invoke<void>("use_discovered", { moduleId, endpointId }),
  setSharePassword: (moduleId: string, endpointId: string, share: boolean) =>
    invoke<void>("set_share_password", { moduleId, endpointId, share }),
  testEndpoint: (moduleId: string, endpointId: string) => invoke<TestResult>("test_endpoint", { moduleId, endpointId }),
  reconnectRelay: () => invoke<void>("reconnect_relay"),
};
