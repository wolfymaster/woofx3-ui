//! The host's calls to a local engine's gateway over capnweb HTTP batch:
//! registering as a client, and checking that stored credentials still
//! authenticate. Each call is one batch, so one HTTP request.

use std::fmt;
use std::time::Duration;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::capnweb::{batch_reply, batch_request, BatchReply, Call, MAIN_STUB};
use super::HostError;

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
    /// goes through.
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
            .build()
            .map_err(HostError::EngineUnreachable)?;
        Ok(HttpEngineGateway { http, api_url })
    }

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
            .map(|_| ())
        })
    }
}
