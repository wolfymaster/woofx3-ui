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
};
