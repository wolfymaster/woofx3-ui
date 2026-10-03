//! The companion's connection to Convex. The Rust process owns it, so it lives
//! as long as the tray icon, not the window.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{anyhow, Result};
use convex::{
    ConvexClient, ConvexClientBuilder, FunctionResult, QuerySubscription, Value, WebSocketState,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tokio::sync::{mpsc, watch};

/// Compiled in by build.rs, so a binary never points at the wrong deployment.
const CONVEX_URL: &str = env!("WOOFX3_CONVEX_URL");

// Convex function names, in one place so a rename in convex/ has one place to
// update here.
const PAIRING_START: &str = "companionPairing:start";
const PAIRING_STATUS: &str = "companionPairing:status";
const PAIRING_CANCEL: &str = "companionPairing:cancel";
const COMPANION_SELF: &str = "companions:self";
const COMPANION_HEARTBEAT: &str = "companions:heartbeat";
const COMPANION_UNPAIR: &str = "companions:unpair";
const COMPANION_CONFIRM: &str = "companions:confirm";
const INTEGRATIONS_FOR_COMPANION: &str = "companionIntegrations:forCompanion";
const INTEGRATIONS_SET_ENDPOINT: &str = "companionIntegrations:setEndpoint";
const INTEGRATIONS_REPORT: &str = "companionIntegrationsActions:reportDiscovered";
const RELAY_CREDENTIAL: &str = "companionRelayActions:companionCredential";

/// How Convex answers a call to a function this deployment does not have.
const MISSING_FUNCTION: &str = "Could not find public function";

/// A mutation or action waits for the connection, so offline it would hang
/// forever without a bound.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// convex-rs reports connection changes with `try_send` and drops what does
/// not fit, so the channel gets room and its own reader.
const STATE_CHANNEL_CAPACITY: usize = 16;

#[derive(Clone)]
pub struct Cloud {
    client: ConvexClient,
    connected: watch::Receiver<bool>,
}

impl Cloud {
    /// Must run inside the Tokio runtime: the client spawns its worker there.
    /// It does not wait for the connection, so it succeeds offline.
    pub async fn connect() -> Result<Self> {
        let (state_tx, mut state_rx) = mpsc::channel(STATE_CHANNEL_CAPACITY);
        let client = ConvexClientBuilder::new(CONVEX_URL)
            .with_on_state_change(state_tx)
            .build()
            .await?;
        let (connected_tx, connected) = watch::channel(false);
        tokio::spawn(async move {
            while let Some(state) = state_rx.recv().await {
                let _ = connected_tx.send(matches!(state, WebSocketState::Connected));
            }
        });
        Ok(Self { client, connected })
    }

    pub fn connection(&self) -> watch::Receiver<bool> {
        self.connected.clone()
    }

    pub async fn start_pairing(&self, request: &StartRequest<'_>) -> Result<PairingStart> {
        let args = string_args(&[
            ("deviceName", request.device_name),
            ("companionVersion", request.companion_version),
            ("installationId", request.installation_id),
            ("tokenHash", request.token_hash),
        ]);
        let result = with_timeout(self.client.clone().action(PAIRING_START, args)).await?;
        decode(result)
    }

    pub async fn watch_pairing_status(&self, device_code: &str) -> Result<QuerySubscription> {
        self.client
            .clone()
            .subscribe(PAIRING_STATUS, string_args(&[("deviceCode", device_code)]))
            .await
    }

    pub async fn watch_self(&self, token: &str) -> Result<QuerySubscription> {
        self.client
            .clone()
            .subscribe(COMPANION_SELF, string_args(&[("token", token)]))
            .await
    }

    pub async fn heartbeat(&self, token: &str, companion_version: &str) -> Result<PairedReply> {
        let args = string_args(&[("token", token), ("companionVersion", companion_version)]);
        let result = with_timeout(self.client.clone().mutation(COMPANION_HEARTBEAT, args)).await?;
        decode(result)
    }

    pub async fn unpair(&self, token: &str) -> Result<()> {
        let result = with_timeout(
            self.client
                .clone()
                .mutation(COMPANION_UNPAIR, string_args(&[("token", token)])),
        )
        .await?;
        decode::<serde_json::Value>(result).map(|_| ())
    }

    /// Marks the pairing confirmed on the server; `paired: false` means the
    /// row is gone or its approval no longer stands.
    pub async fn confirm(&self, token: &str) -> Result<PairedReply> {
        let result = with_timeout(
            self.client
                .clone()
                .mutation(COMPANION_CONFIRM, string_args(&[("token", token)])),
        )
        .await?;
        decode(result)
    }

    /// The installed modules' local endpoints, as the Integrations tab lists
    /// them. A null result means the token is not a confirmed companion's.
    pub async fn watch_integrations(&self, token: &str) -> Result<QuerySubscription> {
        self.client
            .clone()
            .subscribe(INTEGRATIONS_FOR_COMPANION, string_args(&[("token", token)]))
            .await
    }

    /// Records what this companion does for one endpoint. Convex keeps the
    /// address only to show it in the browser.
    pub async fn set_endpoint(&self, token: &str, record: &EndpointRecord<'_>) -> Result<()> {
        let mut args = string_args(&[
            ("token", token),
            ("moduleId", record.module_id),
            ("endpointId", record.endpoint_id),
        ]);
        args.insert("enabled".into(), Value::from(record.enabled));
        args.insert("discovered".into(), Value::from(record.discovered));
        args.insert("sharesPassword".into(), Value::from(record.shares_password));
        if let Some((host, port)) = record.address {
            args.insert(
                "address".into(),
                object(vec![
                    ("host", Value::from(host)),
                    // Convex's v.number() is a float64.
                    ("port", Value::from(f64::from(port))),
                ]),
            );
        }
        let result = with_timeout(
            self.client
                .clone()
                .mutation(INTEGRATIONS_SET_ENDPOINT, args),
        )
        .await?;
        decode_integration::<serde_json::Value>(result).map(|_| ())
    }

    /// Fills in the module settings an endpoint's `local[]` entry names. Convex
    /// writes only those keys, and skips any the streamer set by hand.
    pub async fn report_discovered(
        &self,
        token: &str,
        module_id: &str,
        endpoint_id: &str,
        values: &DiscoveredValues,
    ) -> Result<()> {
        let mut args = string_args(&[
            ("token", token),
            ("moduleId", module_id),
            ("endpointId", endpoint_id),
        ]);
        let mut fields = Vec::new();
        if let Some(host) = &values.host {
            fields.push(("host", Value::from(host.as_str())));
        }
        if let Some(port) = values.port {
            fields.push(("port", Value::from(f64::from(port))));
        }
        if let Some(password) = &values.password {
            fields.push(("password", Value::from(password.as_str())));
        }
        args.insert("values".into(), object(fields));
        let result = with_timeout(self.client.clone().action(INTEGRATIONS_REPORT, args)).await?;
        decode_integration::<serde_json::Value>(result).map(|_| ())
    }

    /// A relay credential, or `None` when woofx3 will not issue one.
    pub async fn relay_credential(&self, token: &str) -> Result<Option<RelayCredential>> {
        let result = with_timeout(
            self.client
                .clone()
                .action(RELAY_CREDENTIAL, string_args(&[("token", token)])),
        )
        .await?;
        decode_integration(result)
    }

    /// Stops a pending pairing from being approved. Idempotent on the server.
    pub async fn cancel_pairing(&self, device_code: &str) -> Result<()> {
        let result = with_timeout(
            self.client
                .clone()
                .mutation(PAIRING_CANCEL, string_args(&[("deviceCode", device_code)])),
        )
        .await?;
        decode::<serde_json::Value>(result).map(|_| ())
    }
}

pub struct StartRequest<'a> {
    pub device_name: &'a str,
    pub companion_version: &'a str,
    pub installation_id: &'a str,
    pub token_hash: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_in_ms: f64,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PairingStatus {
    Pending,
    Approved,
    Denied,
    Cancelled,
    Unknown,
}

#[derive(Debug, Deserialize)]
pub struct PairingStatusReply {
    pub status: PairingStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub companion_id: String,
    pub instance_id: String,
    pub instance_name: String,
    pub approved_by_name: String,
    pub confirmed: bool,
}

#[derive(Debug, Deserialize)]
pub struct PairedReply {
    pub paired: bool,
}

/// What `companions:self` said. An error from the query is not a revocation:
/// only a null result means the companion is no longer paired.
#[derive(Debug)]
pub enum SelfUpdate {
    Paired(CompanionInfo),
    Unpaired,
    Failed(anyhow::Error),
}

impl SelfUpdate {
    pub fn from_result(result: FunctionResult) -> Self {
        match result {
            FunctionResult::Value(Value::Null) => SelfUpdate::Unpaired,
            other => match decode::<CompanionInfo>(other) {
                Ok(info) => SelfUpdate::Paired(info),
                Err(err) => SelfUpdate::Failed(err),
            },
        }
    }
}

/// What `setEndpoint` records. `address` is the host and port shown in the
/// browser.
pub struct EndpointRecord<'a> {
    pub module_id: &'a str,
    pub endpoint_id: &'a str,
    pub enabled: bool,
    pub address: Option<(&'a str, u16)>,
    pub discovered: bool,
    pub shares_password: bool,
}

/// The values the companion found for an endpoint's settings. Each is sent
/// only when present.
#[derive(Default)]
pub struct DiscoveredValues {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub password: Option<String>,
}

/// `expires_at` is milliseconds since the epoch on Convex's clock.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayCredential {
    pub relay_url: String,
    pub credential: String,
    pub expires_at: f64,
}

/// `companionIntegrations:forCompanion` for a confirmed companion.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceIntegrations {
    pub relay_available: bool,
    pub modules: Vec<LocalModule>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalModule {
    pub module_id: String,
    pub module_name: String,
    pub endpoints: Vec<LocalEndpoint>,
}

/// One `local[]` entry of an installed module. It names setting keys, never
/// their values, and never an address: what the companion dials comes only
/// from its own store.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEndpoint {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub discover: Option<Discover>,
    pub keys: SettingKeys,
    pub state: Option<RecordedState>,
    /// Keys the streamer set by hand, which the companion must not report.
    pub manual_keys: Vec<String>,
}

impl LocalEndpoint {
    /// Only WebSocket endpoints can be bridged; `http` ones are declared but
    /// not carried yet.
    pub fn bridgeable(&self) -> bool {
        self.protocol == "websocket"
    }

    pub fn known_discoverer(&self) -> Option<&str> {
        self.discover
            .as_ref()
            .and_then(|discover| discover.known.as_deref())
    }

    pub fn is_manual(&self, key: &str) -> bool {
        self.manual_keys.iter().any(|manual| manual == key)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Discover {
    pub mdns: Option<String>,
    pub known: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SettingKeys {
    pub host: String,
    pub port: String,
    pub password: Option<String>,
}

/// Convex's copy of what this companion last recorded with `setEndpoint`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordedState {
    pub enabled: bool,
    pub address: Option<RecordedAddress>,
    pub discovered: bool,
    pub shares_password: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct RecordedAddress {
    pub host: String,
    pub port: f64,
}

/// What `forCompanion` said. As with `companions:self`, only a null result
/// means the companion is not confirmed; an error changes nothing.
#[derive(Debug)]
pub enum IntegrationsUpdate {
    Ready(InstanceIntegrations),
    NotConfirmed,
    Failed(anyhow::Error),
}

impl IntegrationsUpdate {
    pub fn from_result(result: FunctionResult) -> Self {
        match result {
            FunctionResult::Value(Value::Null) => IntegrationsUpdate::NotConfirmed,
            other => match decode_integration::<InstanceIntegrations>(other) {
                Ok(integrations) => IntegrationsUpdate::Ready(integrations),
                Err(err) => IntegrationsUpdate::Failed(err),
            },
        }
    }
}

/// The deployment this companion talks to predates companion integrations.
#[derive(Debug)]
pub struct IntegrationsUnavailable;

impl std::fmt::Display for IntegrationsUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Integrations need a newer woofx3.")
    }
}

impl std::error::Error for IntegrationsUnavailable {}

pub fn is_integrations_unavailable(err: &anyhow::Error) -> bool {
    err.downcast_ref::<IntegrationsUnavailable>().is_some()
}

/// `decode`, except that calling a function Convex does not have becomes
/// [`IntegrationsUnavailable`].
fn decode_integration<T: DeserializeOwned>(result: FunctionResult) -> Result<T> {
    if let FunctionResult::ErrorMessage(message) = &result {
        if message.contains(MISSING_FUNCTION) {
            return Err(anyhow::Error::new(IntegrationsUnavailable));
        }
    }
    decode(result)
}

fn object(fields: Vec<(&str, Value)>) -> Value {
    Value::Object(
        fields
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}

fn string_args(pairs: &[(&str, &str)]) -> BTreeMap<String, Value> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_string(), Value::from(*value)))
        .collect()
}

async fn with_timeout<F>(request: F) -> Result<FunctionResult>
where
    F: std::future::Future<Output = Result<FunctionResult>>,
{
    tokio::time::timeout(REQUEST_TIMEOUT, request)
        .await
        .map_err(|_| anyhow!("woofx3 did not answer in time. Check your internet connection."))?
}

/// Shown for any failure whose text came from the server. Convex's own error
/// text can quote a function's arguments (an argument validator failure
/// prints the value), and those include the companion's token, so it never
/// reaches a log or the window.
const SERVER_ERROR: &str = "woofx3 could not complete the request.";
const UNREADABLE_REPLY: &str = "woofx3 sent a reply this companion cannot read.";

/// A function's return value, or an error safe to log and show. Only a
/// `ConvexError` whose data is a string keeps its text: woofx3's functions
/// throw those with fixed, user-facing messages.
pub fn decode<T: DeserializeOwned>(result: FunctionResult) -> Result<T> {
    match result {
        // serde's message can quote the value it could not read.
        FunctionResult::Value(value) => {
            serde_json::from_value(value.export()).map_err(|_| anyhow!(UNREADABLE_REPLY))
        }
        FunctionResult::ErrorMessage(_) => Err(anyhow!(SERVER_ERROR)),
        FunctionResult::ConvexError(err) => match err.data {
            Value::String(message) => Err(anyhow!(message)),
            _ => Err(anyhow!(SERVER_ERROR)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(pairs: &[(&str, Value)]) -> FunctionResult {
        FunctionResult::Value(Value::Object(
            pairs
                .iter()
                .map(|(key, value)| ((*key).to_string(), value.clone()))
                .collect(),
        ))
    }

    #[test]
    fn null_self_means_unpaired_and_an_error_does_not() {
        assert!(matches!(
            SelfUpdate::from_result(FunctionResult::Value(Value::Null)),
            SelfUpdate::Unpaired
        ));
        assert!(matches!(
            SelfUpdate::from_result(FunctionResult::ErrorMessage("boom".into())),
            SelfUpdate::Failed(_)
        ));
        let paired = SelfUpdate::from_result(object(&[
            ("companionId", Value::from("c1")),
            ("instanceId", Value::from("i1")),
            ("instanceName", Value::from("Main")),
            ("approvedByName", Value::from("Wolfy")),
            ("confirmed", Value::from(false)),
        ]));
        match paired {
            SelfUpdate::Paired(info) => {
                assert_eq!(info.companion_id, "c1");
                assert_eq!(info.instance_id, "i1");
                assert_eq!(info.instance_name, "Main");
                assert_eq!(info.approved_by_name, "Wolfy");
            }
            other => panic!("expected Paired, got {other:?}"),
        }
    }

    #[test]
    fn decodes_start_and_status_replies() {
        let start: PairingStart = decode(object(&[
            ("deviceCode", Value::from("d")),
            ("userCode", Value::from("BCDF-GHJK")),
            ("verificationUrl", Value::from("https://example.test")),
            ("expiresAt", Value::from(1.0)),
            ("expiresInMs", Value::from(600000.0)),
        ]))
        .expect("start decodes");
        assert_eq!(start.expires_in_ms, 600000.0);
        let status: PairingStatusReply =
            decode(object(&[("status", Value::from("denied"))])).expect("status");
        assert_eq!(status.status, PairingStatus::Denied);
    }

    #[test]
    fn decodes_the_companions_view_of_its_integrations() {
        let reply = serde_json::json!({
            "relayAvailable": true,
            "modules": [{
                "moduleId": "woofx3_obs",
                "moduleName": "OBS",
                "endpoints": [{
                    "id": "obs",
                    "name": "OBS WebSocket",
                    "protocol": "websocket",
                    "discover": { "known": "obs-websocket" },
                    "keys": { "host": "host", "port": "port", "password": "password" },
                    "state": {
                        "enabled": true,
                        "address": { "host": "127.0.0.1", "port": 4455.0 },
                        "discovered": true,
                        "sharesPassword": false,
                    },
                    "manualKeys": ["port"],
                }],
            }],
        });
        let value = Value::try_from(reply).expect("a Convex value");
        let IntegrationsUpdate::Ready(integrations) =
            IntegrationsUpdate::from_result(FunctionResult::Value(value))
        else {
            panic!("expected Ready");
        };
        let endpoint = &integrations.modules[0].endpoints[0];
        assert!(integrations.relay_available);
        assert!(endpoint.bridgeable());
        assert_eq!(endpoint.known_discoverer(), Some("obs-websocket"));
        assert_eq!(endpoint.keys.password.as_deref(), Some("password"));
        assert!(endpoint.is_manual("port"));
        assert!(!endpoint.is_manual("host"));
        let state = endpoint.state.as_ref().expect("state");
        assert_eq!(state.address.as_ref().map(|a| a.port), Some(4455.0));
    }

    #[test]
    fn null_integrations_mean_not_confirmed() {
        assert!(matches!(
            IntegrationsUpdate::from_result(FunctionResult::Value(Value::Null)),
            IntegrationsUpdate::NotConfirmed
        ));
    }

    #[test]
    fn a_missing_function_means_integrations_are_unavailable() {
        let err = decode_integration::<serde_json::Value>(FunctionResult::ErrorMessage(
            "[Request ID: 1] Server Error\nCould not find public function for 'companionIntegrations:forCompanion'"
                .into(),
        ))
        .expect_err("is an error");
        assert!(is_integrations_unavailable(&err));
        let other =
            decode_integration::<serde_json::Value>(FunctionResult::ErrorMessage("boom".into()))
                .expect_err("is an error");
        assert!(!is_integrations_unavailable(&other));
    }

    #[test]
    fn server_error_text_never_comes_through() {
        let leaky =
            "ArgumentValidationError: Value does not match validator. Value: \"wfxc_secret\"";
        let err = decode::<serde_json::Value>(FunctionResult::ErrorMessage(leaky.into()))
            .expect_err("is an error");
        assert_eq!(err.to_string(), SERVER_ERROR);
        let err = decode::<PairedReply>(object(&[("paired", Value::from("wfxc_secret"))]))
            .expect_err("is an error");
        assert_eq!(err.to_string(), UNREADABLE_REPLY);
    }

    #[test]
    fn convex_error_data_becomes_the_message() {
        let err = decode::<serde_json::Value>(FunctionResult::ConvexError(convex::ConvexError {
            message: "redacted".into(),
            data: Value::from("Too many pairing attempts."),
        }))
        .expect_err("is an error");
        assert_eq!(err.to_string(), "Too many pairing attempts.");
    }
}
