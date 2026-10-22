//! A stand-in for the local engine's Twitch calls, for the tests of the
//! host's workers that act through the engine.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use tokio::sync::mpsc;

use super::gateway::{ClientCredentials, EngineGateway, TwitchHelixResult};
use super::registration::LocalSession;
use super::HostError;

/// A call the fake engine received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineCall {
    SendShoutout(String),
    CreateStreamMarker(String),
    IsLive,
}

/// Answers each Twitch call with the next scripted reply, and reports
/// each call as it arrives. A call with no reply scripted yet waits for
/// one, so a test can look at the worker mid-call.
pub struct FakeEngine {
    replies: Mutex<VecDeque<Result<TwitchHelixResult, HostError>>>,
    live: Mutex<VecDeque<Result<bool, HostError>>>,
    calls: mpsc::UnboundedSender<EngineCall>,
    /// Signalled when a reply is scripted, for calls waiting on one.
    scripted: tokio::sync::Notify,
}

impl FakeEngine {
    pub fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<EngineCall>) {
        let (calls, received) = mpsc::unbounded_channel();
        let engine = FakeEngine {
            replies: Mutex::new(VecDeque::new()),
            live: Mutex::new(VecDeque::new()),
            calls,
            scripted: tokio::sync::Notify::new(),
        };
        (Arc::new(engine), received)
    }

    pub fn reply(&self, reply: Result<TwitchHelixResult, HostError>) {
        self.replies.lock().expect("replies lock").push_back(reply);
        self.scripted.notify_waiters();
    }

    pub fn live(&self, reply: Result<bool, HostError>) {
        self.live.lock().expect("live lock").push_back(reply);
        self.scripted.notify_waiters();
    }

    async fn next<T>(&self, queue: &Mutex<VecDeque<T>>) -> T {
        loop {
            let notified = self.scripted.notified();
            if let Some(reply) = queue.lock().expect("reply lock").pop_front() {
                return reply;
            }
            notified.await;
        }
    }
}

impl EngineGateway for FakeEngine {
    fn register_client<'a>(
        &'a self,
        _description: &'a str,
        _registration_token: &'a str,
    ) -> BoxFuture<'a, Result<ClientCredentials, HostError>> {
        unimplemented!("the shoutout and marker tests never register")
    }

    fn verify<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<(), HostError>> {
        unimplemented!("the shoutout and marker tests never verify")
    }

    fn send_shoutout<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
        to_broadcaster_id: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>> {
        let _ = self
            .calls
            .send(EngineCall::SendShoutout(to_broadcaster_id.to_string()));
        Box::pin(self.next(&self.replies))
    }

    fn create_stream_marker<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
        description: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>> {
        let _ = self
            .calls
            .send(EngineCall::CreateStreamMarker(description.to_string()));
        Box::pin(self.next(&self.replies))
    }

    fn is_live<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<bool, HostError>> {
        let _ = self.calls.send(EngineCall::IsLive);
        Box::pin(self.next(&self.live))
    }
}

pub fn ready_session() -> LocalSession {
    LocalSession::Ready(ClientCredentials {
        client_id: "host".to_string(),
        client_secret: "host-secret".to_string(),
    })
}

pub fn refused(status: u16, body: &str) -> Result<TwitchHelixResult, HostError> {
    Ok(TwitchHelixResult::Refused {
        status,
        body: body.to_string(),
    })
}
