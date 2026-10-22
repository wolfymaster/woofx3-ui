//! The window's contract: every value the host sends the window, as a
//! command result or an event, the event names, the commands the window may
//! call and their arguments. With the `ts` feature, the window's TypeScript
//! types are generated from these (`bindings`), so serde's attributes here
//! decide the wire shape for both.

#[cfg(feature = "ts")]
mod bindings;
mod command_args;
mod command_names;

use serde::Serialize;

#[cfg(feature = "ts")]
pub use bindings::{window_bindings, BINDINGS_FILE};
pub use command_args::{
    ConfirmAddressArgs, EnqueueShoutoutArgs, RemoveShoutoutArgs, ReorderShoutoutsArgs,
    SetEndpointEnabledArgs, SetSharePasswordArgs, TestEndpointArgs, UseDiscoveredArgs,
};

/// The largest integer a JavaScript number holds exactly, 2^53 - 1
/// (`Number.MAX_SAFE_INTEGER`). The window's bindings type every integer
/// the host sends as `number`, so none may exceed it; a value that could
/// must be sent as a string instead.
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

macro_rules! command_name_list {
    ($($name:ident($args:ty) -> $result:ty),* $(,)?) => {
        &[$(stringify!($name)),*]
    };
}

/// Every command the window may call, in the order the host registers them.
pub const COMMAND_NAMES: &[&str] = crate::with_command_names!(command_name_list);

/// Where pairing stands.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CompanionState {
    Starting,
    /// A stored token exists but Convex has not answered yet, so whether it
    /// is still paired, or confirmed, cannot be told.
    Offline,
    Unpaired,
    /// `expires_at` is milliseconds since the epoch on this PC's clock.
    #[serde(rename_all = "camelCase")]
    Pairing {
        user_code: String,
        verification_url: String,
        expires_at: u64,
    },
    /// Approved in the browser; waiting for the person at this PC to confirm
    /// that the instance and the approver are theirs.
    #[serde(rename_all = "camelCase")]
    ConfirmPairing {
        instance_name: String,
        approved_by: String,
    },
    #[serde(rename_all = "camelCase")]
    Paired {
        instance_name: String,
        cloud_connected: bool,
    },
    Error {
        message: String,
    },
}

impl CompanionState {
    /// The one-line summary on the tray menu.
    pub fn tray_label(&self) -> String {
        match self {
            CompanionState::Starting => "Starting…".to_string(),
            CompanionState::Offline => "Offline".to_string(),
            CompanionState::Unpaired | CompanionState::Error { .. } => "Not paired".to_string(),
            CompanionState::Pairing { .. } => "Pairing…".to_string(),
            CompanionState::ConfirmPairing { .. } => "Waiting for you to confirm".to_string(),
            CompanionState::Paired {
                instance_name,
                cloud_connected: true,
            } => format!("Paired with {instance_name}"),
            CompanionState::Paired {
                cloud_connected: false,
                ..
            } => "Offline".to_string(),
        }
    }
}

/// What the window renders: where pairing stands, plus the update waiting to
/// be installed, if any. The pairing state's fields sit at the top level next
/// to `update`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
pub struct WindowState {
    #[serde(flatten)]
    pub state: CompanionState,
    pub update: Option<ReadyUpdate>,
}

/// A newer release, downloaded and verified, that installs on Restart to
/// update.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
pub struct ReadyUpdate {
    pub version: String,
}

impl ReadyUpdate {
    /// The tray menu item that installs it.
    pub fn tray_label(&self) -> String {
        format!("Restart to update to {}", self.version)
    }
}

/// Carries [`WindowState`] after every change.
pub const STATE_EVENT: &str = "companion://state";

/// Carries [`IntegrationsView`] after every change.
pub const INTEGRATIONS_EVENT: &str = "companion://integrations";

/// Carries the shoutout queue's view after every change. Local mode
/// only.
pub const SHOUTOUT_QUEUE_EVENT: &str = "companion://shoutout-queue";

/// Carries the stream start marker's state after every change. Local mode
/// only.
pub const STREAM_START_MARKER_EVENT: &str = "companion://stream-start-marker";

/// What the Integrations tab and the Status tab's relay row render. Sent on
/// its own event, apart from `WindowState`, because it changes with every
/// relay reconnect and discovery pass.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsView {
    pub availability: Availability,
    /// Whether this woofx3 offers the companion relay at all.
    pub relay_available: bool,
    pub relay: RelayView,
    pub modules: Vec<ModuleView>,
}

impl IntegrationsView {
    pub fn off() -> Self {
        IntegrationsView {
            availability: Availability::Off,
            relay_available: false,
            relay: RelayView::NotNeeded,
            modules: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Availability {
    /// Not paired and confirmed, so integrations are not running.
    Off,
    Loading,
    Ready,
    /// The woofx3 this companion talks to predates companion integrations.
    Unavailable,
    Failed {
        message: String,
    },
}

/// The companion's connection to the relay.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RelayView {
    /// No enabled endpoint needs it.
    NotNeeded,
    /// Endpoints are enabled, but this woofx3 does not offer the relay.
    Unavailable,
    Connecting,
    Connected,
    /// `retry_at` is milliseconds since the epoch on this PC's clock.
    #[serde(rename_all = "camelCase")]
    Retrying {
        retry_at: u64,
        error: String,
    },
    /// Another companion connection for this instance took over. The
    /// companion does not take it back on its own.
    Displaced,
    /// woofx3 would not issue a relay credential.
    Refused,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ModuleView {
    pub module_id: String,
    pub module_name: String,
    pub endpoints: Vec<EndpointView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EndpointView {
    pub id: String,
    pub name: String,
    /// Only WebSocket endpoints can be carried over the relay today.
    pub bridgeable: bool,
    /// The built-in discoverer serving this endpoint, when one does. The
    /// window keys its discoverer-specific hints by it.
    pub discoverer: Option<String>,
    pub discovery: DiscoveryView,
    /// The address the bridge dials, once discovered or confirmed.
    pub address: Option<AddressView>,
    pub enabled: bool,
    pub share_password: bool,
    /// The endpoint has a password setting and its discoverer reads one.
    pub can_share_password: bool,
    /// The streamer typed the password into the module's settings, so the
    /// companion leaves it alone.
    pub password_set_by_hand: bool,
    /// Why the last attempt to fill in the module's settings failed.
    pub report_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct AddressView {
    /// `host:port`, with brackets around an IPv6 host.
    pub display: String,
    pub origin: crate::AddressOrigin,
}

/// What discovery found for an endpoint.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiscoveryView {
    /// The endpoint declares no discovery: its address is entered by hand.
    Manual,
    /// It names a discoverer this companion does not have.
    Unsupported,
    /// It names a discoverer this companion has, which does not serve its
    /// module.
    NotPermitted,
    /// Discovery has not run yet.
    Searching,
    NotFound,
    /// The server is configured but switched off.
    ServerOff {
        port: u16,
    },
    #[serde(rename_all = "camelCase")]
    Found {
        port: u16,
        has_password: bool,
    },
    /// The discoverer's source exists but could not be read.
    Unreadable,
}

/// The result of the Test button.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TestResult {
    Ok { protocol: Option<String> },
    Refused { reason: String },
    TimedOut,
}

/// What the window needs to open its own capnweb session with the local
/// engine: the engine's `/api` URL and the client credentials this host
/// registered.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LocalEngineSession {
    /// Companion mode: this host runs no engine.
    NotLocal,
    /// The engine is starting, or this host is registering with it.
    Starting,
    #[serde(rename_all = "camelCase")]
    Ready {
        api_url: String,
        client_id: String,
        client_secret: String,
    },
    /// Registering failed; it is tried again while the engine runs.
    Failed { reason: String },
}

/// Never prints the client secret.
impl std::fmt::Debug for LocalEngineSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LocalEngineSession::NotLocal => f.write_str("NotLocal"),
            LocalEngineSession::Starting => f.write_str("Starting"),
            LocalEngineSession::Ready {
                api_url, client_id, ..
            } => f
                .debug_struct("Ready")
                .field("api_url", api_url)
                .field("client_id", client_id)
                .field("client_secret", &"<redacted>")
                .finish(),
            LocalEngineSession::Failed { reason } => {
                f.debug_struct("Failed").field("reason", reason).finish()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_engine_session_debug_output_redacts_the_secret() {
        let printed = format!(
            "{:?}",
            LocalEngineSession::Ready {
                api_url: "http://127.0.0.1:5050/api".into(),
                client_id: "id".into(),
                client_secret: "secret".into(),
            }
        );
        assert!(printed.contains("id"));
        assert!(!printed.contains("\"secret\""));
    }

    #[test]
    fn names_the_version_on_the_tray_item() {
        let update = ReadyUpdate {
            version: "1.2.3".into(),
        };
        assert_eq!(update.tray_label(), "Restart to update to 1.2.3");
    }
}
