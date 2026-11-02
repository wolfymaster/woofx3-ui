import { listen } from "@tauri-apps/api/event";
import { COMMANDS, INTEGRATIONS_EVENT, type IntegrationsView, STATE_EVENT, type WindowState } from "./generated/window";
import { call } from "./invoke";

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
  return call(COMMANDS.get_state);
}

export function onStateChange(handler: (state: WindowState) => void): Promise<() => void> {
  return listen<WindowState>(STATE_EVENT, (event) => handler(event.payload));
}

export async function currentIntegrations(): Promise<IntegrationsView> {
  return call(COMMANDS.get_integrations);
}

export function onIntegrationsChange(handler: (view: IntegrationsView) => void): Promise<() => void> {
  return listen<IntegrationsView>(INTEGRATIONS_EVENT, (event) => handler(event.payload));
}

export const commands = {
  startPairing: () => call(COMMANDS.start_pairing),
  cancelPairing: () => call(COMMANDS.cancel_pairing),
  openVerificationUrl: () => call(COMMANDS.open_verification_url),
  confirmPairing: () => call(COMMANDS.confirm_pairing),
  rejectPairing: () => call(COMMANDS.reject_pairing),
  unpair: () => call(COMMANDS.unpair),
  /** Settles only if installing fails: on success the companion restarts. */
  installUpdate: () => call(COMMANDS.install_update),
  reconnectRelay: () => call(COMMANDS.reconnect_relay),
};
