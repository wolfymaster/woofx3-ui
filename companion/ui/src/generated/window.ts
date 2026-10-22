// Generated from the Rust wire types in companion/core (src/window/bindings.rs).
// Do not edit. To regenerate, run in companion/core:
//   cargo run --example write_window_bindings

/**
 * Where pairing stands.
 */
export type CompanionState = { "kind": "starting" } | { "kind": "offline" } | { "kind": "unpaired" } | { "kind": "pairing", userCode: string, verificationUrl: string, expiresAt: number, } | { "kind": "confirmPairing", instanceName: string, approvedBy: string, } | { "kind": "paired", instanceName: string, cloudConnected: boolean, } | { "kind": "error", message: string, };

/**
 * A newer release, downloaded and verified, that installs on Restart to
 * update.
 */
export type ReadyUpdate = { version: string, };

/**
 * What the window renders: where pairing stands, plus the update waiting to
 * be installed, if any. The pairing state's fields sit at the top level next
 * to `update`.
 */
export type WindowState = { update: ReadyUpdate | null, } & ({ "kind": "starting" } | { "kind": "offline" } | { "kind": "unpaired" } | { "kind": "pairing", userCode: string, verificationUrl: string, expiresAt: number, } | { "kind": "confirmPairing", instanceName: string, approvedBy: string, } | { "kind": "paired", instanceName: string, cloudConnected: boolean, } | { "kind": "error", message: string, });

export type Availability = { "kind": "off" } | { "kind": "loading" } | { "kind": "ready" } | { "kind": "unavailable" } | { "kind": "failed", message: string, };

/**
 * The companion's connection to the relay.
 */
export type RelayView = { "kind": "notNeeded" } | { "kind": "unavailable" } | { "kind": "connecting" } | { "kind": "connected" } | { "kind": "retrying", retryAt: number, error: string, } | { "kind": "displaced" } | { "kind": "refused" };

/**
 * What discovery found for an endpoint.
 */
export type DiscoveryView = { "kind": "manual" } | { "kind": "unsupported" } | { "kind": "notPermitted" } | { "kind": "searching" } | { "kind": "notFound" } | { "kind": "serverOff", port: number, } | { "kind": "found", port: number, hasPassword: boolean, } | { "kind": "unreadable" };

export type AddressOrigin = "discovered" | "confirmed";

export type AddressView = { 
/**
 * `host:port`, with brackets around an IPv6 host.
 */
display: string, origin: AddressOrigin, };

export type EndpointView = { id: string, name: string, 
/**
 * Only WebSocket endpoints can be carried over the relay today.
 */
bridgeable: boolean, 
/**
 * The built-in discoverer serving this endpoint, when one does. The
 * window keys its discoverer-specific hints by it.
 */
discoverer: string | null, discovery: DiscoveryView, 
/**
 * The address the bridge dials, once discovered or confirmed.
 */
address: AddressView | null, enabled: boolean, sharePassword: boolean, 
/**
 * The endpoint has a password setting and its discoverer reads one.
 */
canSharePassword: boolean, 
/**
 * The streamer typed the password into the module's settings, so the
 * companion leaves it alone.
 */
passwordSetByHand: boolean, 
/**
 * Why the last attempt to fill in the module's settings failed.
 */
reportError: string | null, };

export type ModuleView = { moduleId: string, moduleName: string, endpoints: Array<EndpointView>, };

/**
 * What the Integrations tab and the Status tab's relay row render. Sent on
 * its own event, apart from `WindowState`, because it changes with every
 * relay reconnect and discovery pass.
 */
export type IntegrationsView = { availability: Availability, 
/**
 * Whether this woofx3 offers the companion relay at all.
 */
relayAvailable: boolean, relay: RelayView, modules: Array<ModuleView>, };

/**
 * The result of the Test button.
 */
export type TestResult = { "kind": "ok", protocol: string | null, } | { "kind": "refused", reason: string, } | { "kind": "timedOut" };

/**
 * What the window needs to open its own capnweb session with the local
 * engine: the engine's `/api` URL and the client credentials this host
 * registered.
 */
export type LocalEngineSession = { "kind": "notLocal" } | { "kind": "starting" } | { "kind": "ready", apiUrl: string, clientId: string, clientSecret: string, } | { "kind": "failed", reason: string, };

/**
 * An entry's id, unique for the life of the queue. A newtype, so serde
 * writes it as the bare number.
 */
export type ShoutoutEntryId = number;

/**
 * The channel to shout out, as the window looked it up.
 */
export type ShoutoutChannel = { twitchUserId: string, login: string, displayName: string, profileImageUrl: string | null, 
/**
 * `partner`, `affiliate`, or empty for neither.
 */
broadcasterType: string | null, };

/**
 * A channel waiting in the queue. Times are [`EpochMillis`].
 */
export type ShoutoutEntry = { id: ShoutoutEntryId, twitchUserId: string, login: string, displayName: string, profileImageUrl: string | null, broadcasterType: string | null, attempts: number, 
/**
 * Not tried again before this.
 */
nextEligibleAt: number, lastError: string | null, };

/**
 * The queue as the window shows it.
 */
export type ShoutoutQueueView = { 
/**
 * In queue order.
 */
entries: Array<ShoutoutEntry>, 
/**
 * Why no shoutout is being sent, while none can be; null otherwise.
 */
pausedReason: string | null, };

/**
 * What enqueueing did.
 */
export type ShoutoutEnqueued = { id: ShoutoutEntryId, 
/**
 * 1-based, in queue order.
 */
position: number, 
/**
 * The channel was already waiting, so it kept its place.
 */
alreadyQueued: boolean, };

/**
 * Where the stream start marker stands. Times are [`EpochMillis`].
 */
export type StreamStartMarker = { "kind": "idle" } | { "kind": "pending", requestedAt: number, } | { "kind": "dropping" } | { "kind": "dropped", droppedAt: number, } | { "kind": "failed", message: string, };

/**
 * The answer to asking for the marker, as the checklist reports each step.
 * Must match `GoLiveStepOutcome` in client/src/engine/types.ts, which also
 * has `skipped` for a step not asked for.
 */
export type MarkerRequestOutcome = { "status": "done" } | { "status": "queued", reason: string, } | { "status": "failed", message: string, };

export const STATE_EVENT = "companion://state";
export const INTEGRATIONS_EVENT = "companion://integrations";
export const SHOUTOUT_QUEUE_EVENT = "companion://shoutout-queue";
export const STREAM_START_MARKER_EVENT = "companion://stream-start-marker";

/** Every command the window may call, by its name. */
export const COMMANDS = {
  get_state: "get_state",
  start_pairing: "start_pairing",
  cancel_pairing: "cancel_pairing",
  open_verification_url: "open_verification_url",
  confirm_pairing: "confirm_pairing",
  reject_pairing: "reject_pairing",
  unpair: "unpair",
  install_update: "install_update",
  get_integrations: "get_integrations",
  set_endpoint_enabled: "set_endpoint_enabled",
  confirm_address: "confirm_address",
  use_discovered: "use_discovered",
  set_share_password: "set_share_password",
  test_endpoint: "test_endpoint",
  reconnect_relay: "reconnect_relay",
  local_engine_session: "local_engine_session",
  shoutout_queue: "shoutout_queue",
  enqueue_shoutout: "enqueue_shoutout",
  remove_shoutout: "remove_shoutout",
  reorder_shoutouts: "reorder_shoutouts",
  stream_start_marker: "stream_start_marker",
  request_stream_start_marker: "request_stream_start_marker",
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];
