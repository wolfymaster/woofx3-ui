//! The host's calls to a local engine's gateway over capnweb HTTP batch:
//! registering as a client, checking that stored credentials still
//! authenticate, and the few authenticated calls the host makes itself (the
//! shoutout queue's sends and the stream start marker). Each call is one
//! batch, so one HTTP request.

use std::fmt;
use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::capnweb::{batch_reply, batch_request, decode_value, BatchReply, Call, MAIN_STUB};
use super::HostError;

/// How the engine's `authenticate` words a refusal: its message starts with
/// this marker. capnweb rebuilds errors with a custom name as plain `Error`
/// on the way to JS clients, so the marker is in the message. Must match
/// `AUTHENTICATION_REFUSED` in the engine's shared/clients/typescript/api/rpc.ts.
const AUTHENTICATION_REFUSED_PREFIX: &str = "AuthenticationRefused: ";

/// The refusal message of engines older than the marker. Must match
/// `ApiGateway.authenticate` in those engines' api/src/gateway.ts.
const LEGACY_INVALID_CREDENTIALS: &str = "Invalid client credentials";

/// Whether an error from `authenticate` says the engine does not know the
/// credentials, as opposed to failing for some other reason. The one place
/// that decides it.
pub fn is_authentication_refused(message: &str) -> bool {
    message.starts_with(AUTHENTICATION_REFUSED_PREFIX) || message == LEGACY_INVALID_CREDENTIALS
}

/// What a client authenticates to the engine with. `registerClient` returns
/// the secret once; whoever loses it must register again.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCredentials {
    pub client_id: String,
    pub client_secret: String,
}

/// Never prints the secret.
impl fmt::Debug for ClientCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClientCredentials")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .finish()
    }
}

/// The engine calls the host makes, so the registration flow can be tested
/// without an engine.
pub trait EngineGateway: Send + Sync {
    fn register_client<'a>(
        &'a self,
        description: &'a str,
        registration_token: &'a str,
    ) -> BoxFuture<'a, Result<ClientCredentials, HostError>>;

    /// Succeeds when `credentials` authenticate and an authenticated call
    /// goes through. Fails with [`HostError::CredentialsRefused`] only when
    /// `authenticate` refused them; any other failure leaves them in doubt.
    fn verify<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<(), HostError>>;

    /// Twitch's shoutout of the channel `to_broadcaster_id` from the
    /// broadcaster, through the engine's `twitchSendShoutout`.
    fn send_shoutout<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
        to_broadcaster_id: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>>;

    /// A marker on the broadcaster's live stream, through the engine's
    /// `twitchCreateStreamMarker`.
    fn create_stream_marker<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
        description: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>>;

    /// Whether the broadcaster is live, from the engine's `getStreamStatus`.
    fn stream_liveness<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<StreamLiveness, HostError>>;
}

/// What the engine's `getStreamStatus` says about the broadcast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamLiveness {
    Live,
    /// Twitch answered that the broadcaster is not live.
    Offline,
    /// The engine could not ask Twitch: no linked account, a refused token,
    /// or a Helix failure. The engine answers those with its offline shape,
    /// but without the broadcaster's `twitchUserId`, which only an answer
    /// from Twitch carries (the engine's api/src/twitch-stream-status.ts).
    Unknown,
}

impl StreamLiveness {
    /// Reads the `StreamStatus` capnweb wrote. Only `isLive` and whether
    /// `twitchUserId` is a string are read: the engine writes absent
    /// optional fields as capnweb's `undefined` form, which the host does
    /// not decode.
    pub fn from_wire(value: &Value) -> Result<Self, HostError> {
        let live = value.get("isLive").and_then(Value::as_bool).ok_or(
            HostError::EngineReplyUnreadable(
                "getStreamStatus did not say whether the stream is live",
            ),
        )?;
        if live {
            return Ok(StreamLiveness::Live);
        }
        match value.get("twitchUserId").and_then(Value::as_str) {
            Some(_) => Ok(StreamLiveness::Offline),
            None => Ok(StreamLiveness::Unknown),
        }
    }
}

/// Why the engine has no answer from Twitch for a Twitch method. Must match
/// `TwitchHelixErrorCode` in the engine's
/// shared/clients/typescript/api/twitch-helix.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TwitchHelixFailure {
    /// The engine refused the arguments before calling Twitch.
    InvalidArguments,
    NotLinked,
    /// The engine's twitch service is not running.
    Unavailable,
    /// The twitch service did not answer in time; Twitch may still have acted.
    Timeout,
    Failed,
}

impl std::str::FromStr for TwitchHelixFailure {
    type Err = ();

    fn from_str(code: &str) -> Result<Self, Self::Err> {
        match code {
            "invalid_arguments" => Ok(TwitchHelixFailure::InvalidArguments),
            "not_linked" => Ok(TwitchHelixFailure::NotLinked),
            "unavailable" => Ok(TwitchHelixFailure::Unavailable),
            "timeout" => Ok(TwitchHelixFailure::Timeout),
            "failed" => Ok(TwitchHelixFailure::Failed),
            _ => Err(()),
        }
    }
}

impl fmt::Display for TwitchHelixFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            TwitchHelixFailure::InvalidArguments => "invalid_arguments",
            TwitchHelixFailure::NotLinked => "not_linked",
            TwitchHelixFailure::Unavailable => "unavailable",
            TwitchHelixFailure::Timeout => "timeout",
            TwitchHelixFailure::Failed => "failed",
        })
    }
}

/// A Twitch method's outcome, as the engine's `TwitchHelixResult` reports
/// it. A refusal is a result rather than a thrown error, so the host can
/// tell Twitch's answer from the engine's own failure. Twitch's body on
/// success is never read here, so it is not kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TwitchHelixResult {
    Ok,
    /// Twitch answered with an error status; `body` is Twitch's, as text.
    Refused {
        status: u16,
        body: String,
    },
    /// The engine got no answer from Twitch.
    Failed {
        code: TwitchHelixFailure,
        error: String,
    },
}

impl TwitchHelixResult {
    /// Reads the value capnweb wrote. Only scalar fields are read, so a
    /// success body holding forms the host does not decode cannot fail it.
    pub fn from_wire(value: &Value) -> Result<Self, HostError> {
        let unreadable = || HostError::EngineReplyUnreadable("not a TwitchHelixResult");
        match value.get("ok").and_then(Value::as_bool) {
            Some(true) => Ok(TwitchHelixResult::Ok),
            Some(false) => {
                let code = value
                    .get("code")
                    .and_then(Value::as_str)
                    .ok_or_else(unreadable)?;
                let error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .ok_or_else(unreadable)?
                    .to_string();
                if code == "helix" {
                    let status = value
                        .get("status")
                        .and_then(Value::as_u64)
                        .and_then(|status| u16::try_from(status).ok())
                        .ok_or_else(unreadable)?;
                    let body = value
                        .get("body")
                        .and_then(Value::as_str)
                        .ok_or_else(unreadable)?
                        .to_string();
                    return Ok(TwitchHelixResult::Refused { status, body });
                }
                let code = code.parse().map_err(|()| unreadable())?;
                Ok(TwitchHelixResult::Failed { code, error })
            }
            None => Err(unreadable()),
        }
    }
}

/// How long the host waits for each call to the engine, connecting included.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GatewayTimeouts {
    /// Calls the engine answers itself: registering and verifying.
    pub request: Duration,
    /// Calls the engine forwards to Twitch. Longer than the engine's own
    /// Twitch timeout (`TWITCH_HELIX_TIMEOUT_MS`, 10 seconds, in the
    /// engine's api/src/routes/twitch.ts) plus its round trip, so the
    /// engine's own `timeout` answer, which says Twitch may still have
    /// acted, arrives before the host gives up on the engine.
    pub twitch_call: Duration,
}

impl Default for GatewayTimeouts {
    fn default() -> Self {
        GatewayTimeouts {
            request: Duration::from_secs(10),
            twitch_call: Duration::from_secs(20),
        }
    }
}

/// The gateway at an engine's `/api` URL.
pub struct HttpEngineGateway {
    http: reqwest::Client,
    api_url: String,
    timeouts: GatewayTimeouts,
}

impl HttpEngineGateway {
    pub fn new(api_url: String, timeouts: GatewayTimeouts) -> Result<Self, HostError> {
        // In an app where reqwest is built with rustls (the updater's
        // feature), building a client panics until a provider is installed.
        crate::install_tls_provider();
        let http = reqwest::Client::builder()
            .timeout(timeouts.request)
            // The engine is on loopback, and the calls carry the registration
            // token and the client secret in plain HTTP, so no proxy from the
            // environment or the OS may see them.
            .no_proxy()
            .build()
            .map_err(HostError::HttpClientBuild)?;
        Ok(HttpEngineGateway {
            http,
            api_url,
            timeouts,
        })
    }

    /// The last call's result, as capnweb wrote it, waiting at most `timeout`.
    async fn call(&self, calls: &[Call<'_>], timeout: Duration) -> Result<Value, HostError> {
        let response = self
            .http
            .post(&self.api_url)
            .timeout(timeout)
            .body(batch_request(calls))
            .send()
            .await
            .map_err(HostError::EngineUnreachable)?;
        let status = response.status();
        if !status.is_success() {
            return Err(HostError::EngineHttpStatus(status.as_u16()));
        }
        let body = response
            .text()
            .await
            .map_err(HostError::EngineUnreachable)?;
        match batch_reply(&body, calls.len() as u64) {
            Ok(BatchReply::Resolved(value)) => Ok(value),
            Ok(BatchReply::Rejected { name, message }) => {
                Err(HostError::EngineRefused { name, message })
            }
            Ok(BatchReply::Aborted { name, message }) => {
                Err(HostError::EngineSessionAborted { name, message })
            }
            Err(unreadable) => Err(HostError::EngineReplyUnreadable(unreadable.0)),
        }
    }

    /// `method` on the API that `credentials` authenticate to, in the same
    /// batch as `authenticate`. A refused `authenticate` rejects the
    /// pipelined call with the same error, so it is reported as
    /// [`HostError::CredentialsRefused`]; anything else came from `method`
    /// or the engine.
    async fn authenticated_call(
        &self,
        credentials: &ClientCredentials,
        method: &str,
        args: Vec<Value>,
        timeout: Duration,
    ) -> Result<Value, HostError> {
        self.call(
            &[
                Call {
                    target: MAIN_STUB,
                    method: "authenticate",
                    args: vec![
                        json!(credentials.client_id),
                        json!(credentials.client_secret),
                    ],
                },
                Call {
                    target: 1,
                    method,
                    args,
                },
            ],
            timeout,
        )
        .await
        .map_err(|err| match err {
            HostError::EngineRefused { message, .. } if is_authentication_refused(&message) => {
                HostError::CredentialsRefused { message }
            }
            other => other,
        })
    }
}

impl EngineGateway for HttpEngineGateway {
    fn register_client<'a>(
        &'a self,
        description: &'a str,
        registration_token: &'a str,
    ) -> BoxFuture<'a, Result<ClientCredentials, HostError>> {
        Box::pin(async move {
            let value = self
                .call(
                    &[Call {
                        target: MAIN_STUB,
                        method: "registerClient",
                        args: vec![
                            json!(description),
                            json!({ "registrationToken": registration_token }),
                        ],
                    }],
                    self.timeouts.request,
                )
                .await?;
            let value = decode_value(&value)
                .map_err(|unreadable| HostError::EngineReplyUnreadable(unreadable.0))?;
            serde_json::from_value(value).map_err(|_| {
                HostError::EngineReplyUnreadable("registerClient did not return credentials")
            })
        })
    }

    fn verify<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<(), HostError>> {
        Box::pin(async move {
            self.authenticated_call(credentials, "getEngineInfo", vec![], self.timeouts.request)
                .await
                // Only whether the call went through matters, so the value is
                // never decoded: a field the host cannot read must not fail it.
                .map(|_| ())
        })
    }

    fn send_shoutout<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
        to_broadcaster_id: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>> {
        Box::pin(async move {
            let value = self
                .authenticated_call(
                    credentials,
                    "twitchSendShoutout",
                    vec![json!({ "to_broadcaster_id": to_broadcaster_id })],
                    self.timeouts.twitch_call,
                )
                .await?;
            TwitchHelixResult::from_wire(&value)
        })
    }

    fn create_stream_marker<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
        description: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>> {
        Box::pin(async move {
            let value = self
                .authenticated_call(
                    credentials,
                    "twitchCreateStreamMarker",
                    vec![json!({ "description": description })],
                    self.timeouts.twitch_call,
                )
                .await?;
            TwitchHelixResult::from_wire(&value)
        })
    }

    fn stream_liveness<'a>(
        &'a self,
        credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<StreamLiveness, HostError>> {
        Box::pin(async move {
            let value = self
                .authenticated_call(
                    credentials,
                    "getStreamStatus",
                    vec![],
                    self.timeouts.twitch_call,
                )
                .await?;
            StreamLiveness::from_wire(&value)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_authentication_refused_recognises_only_the_refusal() {
        let cases = [
            ("AuthenticationRefused: Invalid client credentials", true),
            ("AuthenticationRefused: client revoked", true),
            ("Invalid client credentials", true),
            ("Invalid client credentials (db-proxy unavailable)", false),
            ("authenticationrefused: Invalid client credentials", false),
            ("AuthenticationRefused", false),
            ("db-proxy unavailable", false),
            ("", false),
        ];
        for (message, refused) in cases {
            assert_eq!(is_authentication_refused(message), refused, "{message:?}");
        }
    }

    #[test]
    fn test_twitch_helix_result_from_wire_reads_every_outcome() {
        let cases = [
            (json!({ "ok": true, "body": null }), TwitchHelixResult::Ok),
            (
                json!({ "ok": true, "body": { "data": [[{ "id": "m" }]] } }),
                TwitchHelixResult::Ok,
            ),
            (
                json!({ "ok": true, "body": ["undefined"] }),
                TwitchHelixResult::Ok,
            ),
            (
                json!({ "ok": false, "code": "helix", "error": "e", "status": 429, "body": "slow down" }),
                TwitchHelixResult::Refused {
                    status: 429,
                    body: "slow down".to_string(),
                },
            ),
            (
                json!({ "ok": false, "code": "helix", "error": "e", "status": 400, "body": "" }),
                TwitchHelixResult::Refused {
                    status: 400,
                    body: String::new(),
                },
            ),
            (
                json!({ "ok": false, "code": "not_linked", "error": "no twitch" }),
                TwitchHelixResult::Failed {
                    code: TwitchHelixFailure::NotLinked,
                    error: "no twitch".to_string(),
                },
            ),
            (
                json!({ "ok": false, "code": "timeout", "error": "slow" }),
                TwitchHelixResult::Failed {
                    code: TwitchHelixFailure::Timeout,
                    error: "slow".to_string(),
                },
            ),
        ];
        for (wire, expected) in cases {
            assert_eq!(
                TwitchHelixResult::from_wire(&wire).expect("readable"),
                expected,
                "{wire}"
            );
        }
    }

    #[test]
    fn test_twitch_helix_result_from_wire_refuses_what_is_not_a_result() {
        for wire in [
            json!(null),
            json!({ "body": null }),
            json!({ "ok": "true" }),
            json!({ "ok": false, "error": "no code" }),
            json!({ "ok": false, "code": "teapot", "error": "unknown code" }),
            json!({ "ok": false, "code": "failed" }),
            json!({ "ok": false, "code": "helix", "error": "e", "body": "no status" }),
            json!({ "ok": false, "code": "helix", "error": "e", "status": 70000, "body": "" }),
            json!({ "ok": false, "code": "helix", "error": "e", "status": 400 }),
        ] {
            assert!(
                matches!(
                    TwitchHelixResult::from_wire(&wire),
                    Err(HostError::EngineReplyUnreadable(_))
                ),
                "{wire}"
            );
        }
    }

    #[test]
    fn test_stream_liveness_from_wire_tells_offline_from_unknown() {
        let cases = [
            (
                json!({ "isLive": true, "uptime": "00:01:00", "streamTitle": ["undefined"] }),
                StreamLiveness::Live,
            ),
            (
                json!({ "isLive": false, "uptime": "00:00:00", "twitchUserId": "7" }),
                StreamLiveness::Offline,
            ),
            (
                json!({ "isLive": false, "uptime": "00:00:00", "viewerCount": 0 }),
                StreamLiveness::Unknown,
            ),
            (
                json!({ "isLive": false, "twitchUserId": ["undefined"] }),
                StreamLiveness::Unknown,
            ),
        ];
        for (wire, expected) in cases {
            assert_eq!(
                StreamLiveness::from_wire(&wire).expect("readable"),
                expected,
                "{wire}"
            );
        }
        for wire in [
            json!({ "uptime": "00:00:00" }),
            json!({ "isLive": "true" }),
            json!(null),
        ] {
            assert!(
                matches!(
                    StreamLiveness::from_wire(&wire),
                    Err(HostError::EngineReplyUnreadable(_))
                ),
                "{wire}"
            );
        }
    }

    #[test]
    fn test_twitch_helix_failure_round_trips_every_code() {
        for code in [
            "invalid_arguments",
            "not_linked",
            "unavailable",
            "timeout",
            "failed",
        ] {
            let parsed: TwitchHelixFailure = code.parse().expect("a known code");
            assert_eq!(parsed.to_string(), code);
        }
        assert!("helix".parse::<TwitchHelixFailure>().is_err());
    }
}
