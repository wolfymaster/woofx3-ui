import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  COMMANDS,
  INTEGRATIONS_EVENT,
  type IntegrationsView,
  STATE_EVENT,
  type TestResult,
  type WindowState,
} from "./generated/window";

export type {
  AddressView,
  Availability,
  CompanionState,
  DiscoveryView,
  EndpointView,
  IntegrationsView,
  ModuleView,
  ReadyUpdate,
  RelayView,
  TestResult,
  WindowState,
} from "./generated/window";

export async function currentState(): Promise<WindowState> {
  return invoke<WindowState>(COMMANDS.get_state);
}

export function onStateChange(handler: (state: WindowState) => void): Promise<() => void> {
  return listen<WindowState>(STATE_EVENT, (event) => handler(event.payload));
}

export async function currentIntegrations(): Promise<IntegrationsView> {
  return invoke<IntegrationsView>(COMMANDS.get_integrations);
}

export function onIntegrationsChange(handler: (view: IntegrationsView) => void): Promise<() => void> {
  return listen<IntegrationsView>(INTEGRATIONS_EVENT, (event) => handler(event.payload));
}

export const commands = {
  startPairing: () => invoke<void>(COMMANDS.start_pairing),
  cancelPairing: () => invoke<void>(COMMANDS.cancel_pairing),
  openVerificationUrl: () => invoke<void>(COMMANDS.open_verification_url),
  confirmPairing: () => invoke<void>(COMMANDS.confirm_pairing),
  rejectPairing: () => invoke<void>(COMMANDS.reject_pairing),
  unpair: () => invoke<void>(COMMANDS.unpair),
  /** Settles only if installing fails: on success the companion restarts. */
  installUpdate: () => invoke<void>(COMMANDS.install_update),
  setEndpointEnabled: (moduleId: string, endpointId: string, enabled: boolean) =>
    invoke<void>(COMMANDS.set_endpoint_enabled, { moduleId, endpointId, enabled }),
  confirmAddress: (moduleId: string, endpointId: string, address: string) =>
    invoke<void>(COMMANDS.confirm_address, { moduleId, endpointId, address }),
  // Not `useDiscovered`, which lint rules would take for a React hook.
  chooseDiscovered: (moduleId: string, endpointId: string) =>
    invoke<void>(COMMANDS.use_discovered, { moduleId, endpointId }),
  setSharePassword: (moduleId: string, endpointId: string, share: boolean) =>
    invoke<void>(COMMANDS.set_share_password, { moduleId, endpointId, share }),
  testEndpoint: (moduleId: string, endpointId: string) =>
    invoke<TestResult>(COMMANDS.test_endpoint, { moduleId, endpointId }),
  reconnectRelay: () => invoke<void>(COMMANDS.reconnect_relay),
};
