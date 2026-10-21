//! The host's calls to a local engine's gateway over capnweb HTTP batch:
//! registering as a client, and checking that stored credentials still
//! authenticate. Each call is one batch, so one HTTP request.

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
}

/// The gateway at an engine's `/api` URL.
pub struct HttpEngineGateway {
    http: reqwest::Client,
    api_url: String,
}

impl HttpEngineGateway {
    /// `timeout` bounds each call, connection included.
    pub fn new(api_url: String, timeout: Duration) -> Result<Self, HostError> {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            // The engine is on loopback, and the calls carry the registration
            // token and the client secret in plain HTTP, so no proxy from the
            // environment or the OS may see them.
            .no_proxy()
            .build()
            .map_err(HostError::HttpClientBuild)?;
        Ok(HttpEngineGateway { http, api_url })
    }

    /// The last call's result, as capnweb wrote it.
    async fn call(&self, calls: &[Call<'_>]) -> Result<Value, HostError> {
        let response = self
            .http
            .post(&self.api_url)
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
}

impl EngineGateway for HttpEngineGateway {
    fn register_client<'a>(
        &'a self,
        description: &'a str,
        registration_token: &'a str,
    ) -> BoxFuture<'a, Result<ClientCredentials, HostError>> {
        Box::pin(async move {
            let value = self
                .call(&[Call {
                    target: MAIN_STUB,
                    method: "registerClient",
                    args: vec![
                        json!(description),
                        json!({ "registrationToken": registration_token }),
                    ],
                }])
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
            self.call(&[
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
                    method: "getEngineInfo",
                    args: vec![],
                },
            ])
            .await
            // A refused authenticate rejects the pipelined call with the same
            // error; anything else came from getEngineInfo or the engine.
            .map_err(|err| match err {
                HostError::EngineRefused { message, .. } if is_authentication_refused(&message) => {
                    HostError::CredentialsRefused { message }
                }
                other => other,
            })
            // Only whether the call went through matters, so the value is
            // never decoded: a field the host cannot read must not fail it.
            .map(|_| ())
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
}
