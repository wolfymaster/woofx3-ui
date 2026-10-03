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

/// A function's return value, or an error carrying Convex's message.
pub fn decode<T: DeserializeOwned>(result: FunctionResult) -> Result<T> {
    match result {
        FunctionResult::Value(value) => Ok(serde_json::from_value(value.export())?),
        FunctionResult::ErrorMessage(message) => Err(anyhow!(message)),
        FunctionResult::ConvexError(err) => match err.data {
            Value::String(message) => Err(anyhow!(message)),
            _ => Err(anyhow!(err.message)),
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
    fn convex_error_data_becomes_the_message() {
        let err = decode::<serde_json::Value>(FunctionResult::ConvexError(convex::ConvexError {
            message: "redacted".into(),
            data: Value::from("Too many pairing attempts."),
        }))
        .expect_err("is an error");
        assert_eq!(err.to_string(), "Too many pairing attempts.");
    }
}
