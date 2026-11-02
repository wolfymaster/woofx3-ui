// Generated from the Rust wire types in companion/core (src/window/bindings.rs).
// Do not edit. To regenerate, run in companion/core:
//   cargo run --features ts --example write_window_bindings

/**
 * Where pairing stands.
 */
export type CompanionState = { "kind": "starting" } | { "kind": "offline" } | { "kind": "unpaired" } | { "kind": "pairing", userCode: string, verificationUrl: string, expiresAt: number, } | { "kind": "confirmPairing", instanceName: string, approvedBy: string, } | { "kind": "paired", instanceName: string, cloudConnected: boolean, } | { "kind": "error", message: string, };

/**
 * A newer release, downloaded and verified, that installs on Restart to
 * update. `product_name` is the running app's, which the window names the
 * update with.
 */
export type ReadyUpdate = { productName: string, version: string, };

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
export type LocalEngineSession = { "kind": "notLocal" } | { "kind": "starting" } | { "kind": "migrating" } | { "kind": "ready", apiUrl: string, clientId: string, clientSecret: string, } | { "kind": "failed", reason: string, } | { "kind": "stopped", reason: string, };

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
 * A channel waiting in the queue. Times are milliseconds since the Unix
 * epoch on this PC's clock.
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
 * Where the stream start marker stands. Times are milliseconds since the Unix
 * epoch on this PC's clock.
 */
export type StreamStartMarker = { "kind": "idle" } | { "kind": "pending", requestedAt: number, } | { "kind": "dropping" } | { "kind": "dropped", droppedAt: number, } | { "kind": "failed", message: string, };

/**
 * The answer to asking for the marker, as the checklist reports each step.
 * Must match `GoLiveStepOutcome` in client/src/engine/types.ts, which also
 * has `skipped` for a step not asked for.
 */
export type MarkerRequestOutcome = { "status": "done" } | { "status": "queued", reason: string, } | { "status": "failed", message: string, };

/**
 * A mode the streamer can choose, without the settings only a hand-written
 * configuration sets.
 */
export type HostModeKind = "local" | "companion";

/**
 * The mode this app runs in, and whether the streamer chose it. Until they
 * have, it runs its build's default and the dashboard asks.
 */
export type HostModeView = { mode: HostModeKind, chosen: boolean, };

/**
 * A confirmed pairing's instance. `instance_id` is missing only for a
 * pairing stored before the id was kept, until Convex next names it.
 */
export type LinkedInstance = { instanceId: string | null, instanceName: string, };

/**
 * What the dashboard needs to decide whether to make this computer the
 * companion of the instance it is signed in to, and to ask Convex to.
 */
export type CompanionLinkStatus = { 
/**
 * The instance this computer is the confirmed companion of, if any.
 */
linked: LinkedInstance | null, installationId: string, deviceName: string, companionVersion: string, };

/**
 * A fresh companion token, held by the host until the link finishes. Only
 * its hash leaves the host, with the details Convex records beside it.
 */
export type AppLinkStart = { tokenHash: string, installationId: string, deviceName: string, companionVersion: string, };

/**
 * Turns an integration endpoint on or off. On needs an address,
 * discovered or confirmed.
 */
export type SetEndpointEnabledArgs = { moduleId: string, endpointId: string, enabled: boolean, };

/**
 * The `host:port` the streamer typed and confirmed.
 */
export type ConfirmAddressArgs = { moduleId: string, endpointId: string, address: string, };

export type UseDiscoveredArgs = { moduleId: string, endpointId: string, };

export type SetSharePasswordArgs = { moduleId: string, endpointId: string, share: boolean, };

export type TestEndpointArgs = { moduleId: string, endpointId: string, };

export type EnqueueShoutoutArgs = { channel: ShoutoutChannel, };

export type RemoveShoutoutArgs = { entryId: ShoutoutEntryId, };

/**
 * The queue's new order. An id no longer queued is skipped; entries left
 * out keep their order after the ones named.
 */
export type ReorderShoutoutsArgs = { entryIds: Array<ShoutoutEntryId>, };

/**
 * The mode the streamer chose the first time the app ran.
 */
export type ChooseHostModeArgs = { mode: HostModeKind, };

/**
 * The instance the signed-in dashboard made this computer the companion
 * of, as Convex named it when it recorded the link.
 */
export type FinishAppLinkArgs = { instanceId: string, instanceName: string, };

/**
 * The hash of the nonce the dashboard keeps for a Twitch sign-in, which
 * binds the sign-in to this app (core/src/twitch_sign_in.rs).
 */
export type OpenTwitchSignInArgs = { nonceHash: string, };

export const STATE_EVENT = "companion://state";
export const INTEGRATIONS_EVENT = "companion://integrations";
export const OPEN_LOCAL_CONNECTIONS_EVENT = "companion://open-local-connections";
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
  host_mode: "host_mode",
  choose_host_mode: "choose_host_mode",
  companion_link_status: "companion_link_status",
  begin_app_link: "begin_app_link",
  finish_app_link: "finish_app_link",
  open_twitch_sign_in: "open_twitch_sign_in",
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

/** Each command's arguments, its one `args` parameter; null for none. */
export type CommandArgs = {
  get_state: null;
  start_pairing: null;
  cancel_pairing: null;
  open_verification_url: null;
  confirm_pairing: null;
  reject_pairing: null;
  unpair: null;
  install_update: null;
  get_integrations: null;
  set_endpoint_enabled: SetEndpointEnabledArgs;
  confirm_address: ConfirmAddressArgs;
  use_discovered: UseDiscoveredArgs;
  set_share_password: SetSharePasswordArgs;
  test_endpoint: TestEndpointArgs;
  reconnect_relay: null;
  local_engine_session: null;
  shoutout_queue: null;
  enqueue_shoutout: EnqueueShoutoutArgs;
  remove_shoutout: RemoveShoutoutArgs;
  reorder_shoutouts: ReorderShoutoutsArgs;
  stream_start_marker: null;
  request_stream_start_marker: null;
  host_mode: null;
  choose_host_mode: ChooseHostModeArgs;
  companion_link_status: null;
  begin_app_link: null;
  finish_app_link: FinishAppLinkArgs;
  open_twitch_sign_in: OpenTwitchSignInArgs;
};

/** What each command resolves to. */
export type CommandResults = {
  get_state: WindowState;
  start_pairing: void;
  cancel_pairing: void;
  open_verification_url: void;
  confirm_pairing: void;
  reject_pairing: void;
  unpair: void;
  install_update: void;
  get_integrations: IntegrationsView;
  set_endpoint_enabled: void;
  confirm_address: void;
  use_discovered: void;
  set_share_password: void;
  test_endpoint: TestResult;
  reconnect_relay: void;
  local_engine_session: LocalEngineSession;
  shoutout_queue: ShoutoutQueueView;
  enqueue_shoutout: ShoutoutEnqueued;
  remove_shoutout: void;
  reorder_shoutouts: void;
  stream_start_marker: StreamStartMarker;
  request_stream_start_marker: MarkerRequestOutcome;
  host_mode: HostModeView;
  choose_host_mode: void;
  companion_link_status: CompanionLinkStatus;
  begin_app_link: AppLinkStart;
  finish_app_link: void;
  open_twitch_sign_in: void;
};
