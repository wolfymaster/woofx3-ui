import {
  type AppLinkStart,
  COMMANDS,
  type CompanionLinkStatus,
  type FinishAppLinkArgs,
  type HostModeKind,
  type HostModeView,
  INTEGRATIONS_EVENT,
  type IntegrationsView,
  type LocalEngineSession,
  type MarkerRequestOutcome,
  OPEN_LOCAL_CONNECTIONS_EVENT,
  SHOUTOUT_QUEUE_EVENT,
  type ShoutoutChannel,
  type ShoutoutEnqueued,
  type ShoutoutEntryId,
  type ShoutoutQueueView,
  STREAM_START_MARKER_EVENT,
  type StreamStartMarker,
  type TestResult,
} from "@desktop-host/window";
import { listen } from "@tauri-apps/api/event";
import { call } from "./invoke";

export type {
  AppLinkStart,
  CompanionLinkStatus,
  DiscoveryView,
  EndpointView,
  FinishAppLinkArgs,
  HostModeKind,
  HostModeView,
  IntegrationsView,
  LocalEngineSession,
  MarkerRequestOutcome,
  ModuleView,
  RelayView,
  ShoutoutChannel,
  ShoutoutEnqueued,
  ShoutoutEntry,
  ShoutoutEntryId,
  ShoutoutQueueView,
  StreamStartMarker,
  TestResult,
} from "@desktop-host/window";

// Calls into the desktop app's Rust host, for the dashboard window. The
// dashboard's capability grants exactly these commands
// (companion/src-tauri/capabilities/dashboard.json).

/** The mode this run of the app started in, and whether the streamer chose it. */
export async function hostMode(): Promise<HostModeView> {
  return call(COMMANDS.host_mode);
}

/**
 * Records the streamer's first choice of mode and restarts the app into it,
 * so this resolves only if the host refuses (a mode is already chosen).
 */
export async function chooseHostMode(mode: HostModeKind): Promise<void> {
  return call(COMMANDS.choose_host_mode, { mode });
}

/** What the webview needs to open its own capnweb session with the local engine. */
export async function localEngineSession(): Promise<LocalEngineSession> {
  return call(COMMANDS.local_engine_session);
}

// ==================== Local-mode UI state ====================
// The shoutout queue and the stream start marker, which this host keeps for
// the window in local mode. Every command below rejects outside local mode.

export async function shoutoutQueue(): Promise<ShoutoutQueueView> {
  return call(COMMANDS.shoutout_queue);
}

/** A channel already waiting keeps its place. */
export async function enqueueShoutout(channel: ShoutoutChannel): Promise<ShoutoutEnqueued> {
  return call(COMMANDS.enqueue_shoutout, { channel });
}

/** Rejects when the entry is no longer queued. */
export async function removeShoutout(entryId: ShoutoutEntryId): Promise<void> {
  await call(COMMANDS.remove_shoutout, { entryId });
}

/** An entry gone meanwhile is skipped; entries left out follow in their order. */
export async function reorderShoutouts(entryIds: ShoutoutEntryId[]): Promise<void> {
  await call(COMMANDS.reorder_shoutouts, { entryIds });
}

export function onShoutoutQueueChange(handler: (queue: ShoutoutQueueView) => void): Promise<() => void> {
  return listen<ShoutoutQueueView>(SHOUTOUT_QUEUE_EVENT, (event) => handler(event.payload));
}

export async function streamStartMarker(): Promise<StreamStartMarker> {
  return call(COMMANDS.stream_start_marker);
}

/** Drops the "Stream start" marker now when the stream is live, else when it next goes live. */
export async function requestStreamStartMarker(): Promise<MarkerRequestOutcome> {
  return call(COMMANDS.request_stream_start_marker);
}

export function onStreamStartMarkerChange(handler: (marker: StreamStartMarker) => void): Promise<() => void> {
  return listen<StreamStartMarker>(STREAM_START_MARKER_EVENT, (event) => handler(event.payload));
}

// ==================== The relay ====================
// Signed in to an account, a cloud engine reaches this computer's local apps
// through the relay. Outside companion mode the view reports it as not needed.

export async function integrations(): Promise<IntegrationsView> {
  return call(COMMANDS.get_integrations);
}

export function onIntegrationsChange(handler: (view: IntegrationsView) => void): Promise<() => void> {
  return listen<IntegrationsView>(INTEGRATIONS_EVENT, (event) => handler(event.payload));
}

/** Connects again after another connection displaced the relay or woofx3 refused it. */
export async function reconnectRelay(): Promise<void> {
  await call(COMMANDS.reconnect_relay);
}

// ==================== Local connections ====================
// The host holds the addresses and decides what the bridge dials. It asks the
// streamer itself before accepting a typed address or sending a password, and
// these reject when they decline.

export async function setEndpointEnabled(moduleId: string, endpointId: string, enabled: boolean): Promise<void> {
  await call(COMMANDS.set_endpoint_enabled, { moduleId, endpointId, enabled });
}

export async function confirmAddress(moduleId: string, endpointId: string, address: string): Promise<void> {
  await call(COMMANDS.confirm_address, { moduleId, endpointId, address });
}

export async function chooseDiscovered(moduleId: string, endpointId: string): Promise<void> {
  await call(COMMANDS.use_discovered, { moduleId, endpointId });
}

export async function setSharePassword(moduleId: string, endpointId: string, share: boolean): Promise<void> {
  await call(COMMANDS.set_share_password, { moduleId, endpointId, share });
}

/** One handshake with the stored address, whether or not the endpoint is on. */
export async function testEndpoint(moduleId: string, endpointId: string): Promise<TestResult> {
  return call(COMMANDS.test_endpoint, { moduleId, endpointId });
}

/** The tray's "Local connections" item. */
export function onOpenLocalConnections(handler: () => void): Promise<() => void> {
  return listen(OPEN_LOCAL_CONNECTIONS_EVENT, handler);
}

// ==================== Linking the companion ====================
// Signed in to an account, the dashboard makes this computer the instance's
// companion. The host keeps the companion token; only its hash reaches the
// webview. Companion mode only.

/** Which instance this computer is the confirmed companion of, if any, and what Convex records about it. */
export async function companionLinkStatus(): Promise<CompanionLinkStatus> {
  return call(COMMANDS.companion_link_status);
}

/** A fresh companion token held by the host, and its hash for Convex. Replaces one that never finished. */
export async function beginAppLink(): Promise<AppLinkStart> {
  return call(COMMANDS.begin_app_link);
}

/**
 * Convex recorded this computer as the instance's companion: the host keeps
 * the token from `beginAppLink` as its confirmed pairing, giving up any
 * previous one, and connects.
 */
export async function finishAppLink(link: FinishAppLinkArgs): Promise<void> {
  await call(COMMANDS.finish_app_link, link);
}

// ==================== Twitch sign-in ====================
// Twitch sign-in runs in the system browser, which the window cannot follow;
// the dashboard keeps the nonce and claims the outcome from Convex itself
// (twitch-sign-in.ts). Companion mode only.

/** Opens the system browser at Convex's Twitch sign-in, bound to the nonce behind `nonceHash`. */
export async function openTwitchSignIn(nonceHash: string): Promise<void> {
  await call(COMMANDS.open_twitch_sign_in, { nonceHash });
}
