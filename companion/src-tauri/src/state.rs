use serde::Serialize;

/// Where pairing stands. Serialized with `kind` as the tag; must match
/// `CompanionState` in companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
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
/// to `update`. Must match `WindowState` in companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WindowState {
    #[serde(flatten)]
    pub state: CompanionState,
    pub update: Option<ReadyUpdate>,
}

/// A newer release, downloaded and verified, that installs on Restart to
/// update.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReadyUpdate {
    pub version: String,
}

impl ReadyUpdate {
    /// The tray menu item that installs it.
    pub fn tray_label(&self) -> String {
        format!("Restart to update to {}", self.version)
    }
}

/// Must match `STATE_EVENT` in companion/ui/src/state.ts.
pub const STATE_EVENT: &str = "companion://state";

/// Must match `INTEGRATIONS_EVENT` in companion/ui/src/state.ts.
pub const INTEGRATIONS_EVENT: &str = "companion://integrations";

/// What the Integrations tab and the Status tab's relay row render. Sent on
/// its own event, apart from `WindowState`, because it changes with every
/// relay reconnect and discovery pass. Must match `IntegrationsView` in
/// companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
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
#[serde(rename_all = "camelCase")]
pub struct ModuleView {
    pub module_id: String,
    pub module_name: String,
    pub endpoints: Vec<EndpointView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
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
#[serde(rename_all = "camelCase")]
pub struct AddressView {
    /// `host:port`, with brackets around an IPv6 host.
    pub display: String,
    pub origin: woofx3_companion_core::AddressOrigin,
}

/// What discovery found for an endpoint. Must match `DiscoveryView` in
/// companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
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

/// The result of the Test button. Must match `TestResult` in
/// companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TestResult {
    Ok { protocol: Option<String> },
    Refused { reason: String },
    TimedOut,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn to_wire<T: Serialize>(value: &T) -> serde_json::Value {
        serde_json::to_value(value).expect("serializes")
    }

    fn wire(state: CompanionState) -> serde_json::Value {
        serde_json::to_value(state).expect("state serializes")
    }

    #[test]
    fn serializes_each_variant_as_the_typescript_mirror_expects() {
        assert_eq!(
            wire(CompanionState::Starting),
            json!({ "kind": "starting" })
        );
        assert_eq!(
            wire(CompanionState::Unpaired),
            json!({ "kind": "unpaired" })
        );
        assert_eq!(wire(CompanionState::Offline), json!({ "kind": "offline" }));
        assert_eq!(
            wire(CompanionState::Pairing {
                user_code: "BCDF-GHJK".into(),
                verification_url: "https://example.test/companion/pair?code=BCDF-GHJK".into(),
                expires_at: 1_700_000_000_000,
            }),
            json!({
                "kind": "pairing",
                "userCode": "BCDF-GHJK",
                "verificationUrl": "https://example.test/companion/pair?code=BCDF-GHJK",
                "expiresAt": 1_700_000_000_000u64,
            })
        );
        assert_eq!(
            wire(CompanionState::ConfirmPairing {
                instance_name: "x".into(),
                approved_by: "y".into(),
            }),
            json!({ "kind": "confirmPairing", "instanceName": "x", "approvedBy": "y" })
        );
        assert_eq!(
            wire(CompanionState::Paired {
                instance_name: "x".into(),
                cloud_connected: true,
            }),
            json!({ "kind": "paired", "instanceName": "x", "cloudConnected": true })
        );
        assert_eq!(
            wire(CompanionState::Error {
                message: "m".into()
            }),
            json!({ "kind": "error", "message": "m" })
        );
    }

    #[test]
    fn puts_the_state_and_the_ready_update_side_by_side() {
        let window = |state, update| {
            serde_json::to_value(WindowState { state, update }).expect("window state serializes")
        };
        assert_eq!(
            window(CompanionState::Unpaired, None),
            json!({ "kind": "unpaired", "update": null })
        );
        assert_eq!(
            window(
                CompanionState::Paired {
                    instance_name: "x".into(),
                    cloud_connected: false,
                },
                Some(ReadyUpdate {
                    version: "1.2.3".into()
                }),
            ),
            json!({
                "kind": "paired",
                "instanceName": "x",
                "cloudConnected": false,
                "update": { "version": "1.2.3" },
            })
        );
    }

    #[test]
    fn serializes_the_integrations_view_as_the_typescript_mirror_expects() {
        let view = IntegrationsView {
            availability: Availability::Ready,
            relay_available: true,
            relay: RelayView::Retrying {
                retry_at: 1_700_000_000_000,
                error: "e".into(),
            },
            modules: vec![ModuleView {
                module_id: "woofx3_obs".into(),
                module_name: "OBS".into(),
                endpoints: vec![EndpointView {
                    id: "obs".into(),
                    name: "OBS WebSocket".into(),
                    bridgeable: true,
                    discoverer: Some("obs-websocket".into()),
                    discovery: DiscoveryView::Found {
                        port: 4455,
                        has_password: true,
                    },
                    address: Some(AddressView {
                        display: "127.0.0.1:4455".into(),
                        origin: woofx3_companion_core::AddressOrigin::Discovered,
                    }),
                    enabled: true,
                    share_password: false,
                    can_share_password: true,
                    password_set_by_hand: false,
                    report_error: None,
                }],
            }],
        };
        assert_eq!(
            serde_json::to_value(view).expect("serializes"),
            json!({
                "availability": { "kind": "ready" },
                "relayAvailable": true,
                "relay": { "kind": "retrying", "retryAt": 1_700_000_000_000u64, "error": "e" },
                "modules": [{
                    "moduleId": "woofx3_obs",
                    "moduleName": "OBS",
                    "endpoints": [{
                        "id": "obs",
                        "name": "OBS WebSocket",
                        "bridgeable": true,
                        "discoverer": "obs-websocket",
                        "discovery": { "kind": "found", "port": 4455, "hasPassword": true },
                        "address": { "display": "127.0.0.1:4455", "origin": "discovered" },
                        "enabled": true,
                        "sharePassword": false,
                        "canSharePassword": true,
                        "passwordSetByHand": false,
                        "reportError": null,
                    }],
                }],
            })
        );
    }

    #[test]
    fn serializes_each_integration_variant() {
        assert_eq!(to_wire(&Availability::Off), json!({ "kind": "off" }));
        assert_eq!(
            to_wire(&Availability::Loading),
            json!({ "kind": "loading" })
        );
        assert_eq!(
            to_wire(&Availability::Unavailable),
            json!({ "kind": "unavailable" })
        );
        assert_eq!(
            to_wire(&Availability::Failed {
                message: "m".into()
            }),
            json!({ "kind": "failed", "message": "m" })
        );
        assert_eq!(
            to_wire(&RelayView::NotNeeded),
            json!({ "kind": "notNeeded" })
        );
        assert_eq!(
            to_wire(&RelayView::Unavailable),
            json!({ "kind": "unavailable" })
        );
        assert_eq!(
            to_wire(&RelayView::Connecting),
            json!({ "kind": "connecting" })
        );
        assert_eq!(
            to_wire(&RelayView::Connected),
            json!({ "kind": "connected" })
        );
        assert_eq!(
            to_wire(&RelayView::Displaced),
            json!({ "kind": "displaced" })
        );
        assert_eq!(to_wire(&RelayView::Refused), json!({ "kind": "refused" }));
        assert_eq!(to_wire(&DiscoveryView::Manual), json!({ "kind": "manual" }));
        assert_eq!(
            to_wire(&DiscoveryView::Unsupported),
            json!({ "kind": "unsupported" })
        );
        assert_eq!(
            to_wire(&DiscoveryView::NotPermitted),
            json!({ "kind": "notPermitted" })
        );
        assert_eq!(
            to_wire(&DiscoveryView::Searching),
            json!({ "kind": "searching" })
        );
        assert_eq!(
            to_wire(&DiscoveryView::NotFound),
            json!({ "kind": "notFound" })
        );
        assert_eq!(
            to_wire(&DiscoveryView::ServerOff { port: 4455 }),
            json!({ "kind": "serverOff", "port": 4455 })
        );
        assert_eq!(
            to_wire(&DiscoveryView::Unreadable),
            json!({ "kind": "unreadable" })
        );
        assert_eq!(
            to_wire(&TestResult::Ok {
                protocol: Some("obswebsocket.json".into())
            }),
            json!({ "kind": "ok", "protocol": "obswebsocket.json" })
        );
        assert_eq!(
            to_wire(&TestResult::Refused { reason: "r".into() }),
            json!({ "kind": "refused", "reason": "r" })
        );
        assert_eq!(
            to_wire(&TestResult::TimedOut),
            json!({ "kind": "timedOut" })
        );
        assert_eq!(
            to_wire(&IntegrationsView::off()),
            json!({
                "availability": { "kind": "off" },
                "relayAvailable": false,
                "relay": { "kind": "notNeeded" },
                "modules": [],
            })
        );
    }

    #[test]
    fn names_the_version_on_the_tray_item() {
        let update = ReadyUpdate {
            version: "1.2.3".into(),
        };
        assert_eq!(update.tray_label(), "Restart to update to 1.2.3");
    }
}
