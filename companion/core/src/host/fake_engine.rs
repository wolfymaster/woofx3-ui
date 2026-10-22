//! A stand-in for the local engine's Twitch calls, for the tests of the
//! host's workers that act through the engine.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use futures::future::BoxFuture;
use tokio::sync::{mpsc, Notify};

use super::gateway::{ClientCredentials, EngineGateway, StreamLiveness, TwitchHelixResult};
use super::registration::LocalSession;
use super::HostError;

/// A call the fake engine received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineCall {
    SendShoutout(String),
    CreateStreamMarker(String),
    StreamLiveness,
}

/// The replies for one kind of call, by the order the calls arrived: the
/// n-th call gets the n-th reply. A reply can be scripted before its call
/// arrives, or for a later call before an earlier one, so a test can hold
/// one call while another completes.
struct Script<T> {
    /// Calls made so far; the next call's ticket.
    issued: usize,
    /// The ticket the next [`Script::push`] answers.
    next_scripted: usize,
    replies: BTreeMap<usize, T>,
}

impl<T> Script<T> {
    fn new() -> Mutex<Self> {
        Mutex::new(Script {
            issued: 0,
            next_scripted: 0,
            replies: BTreeMap::new(),
        })
    }
}

/// Answers each Twitch call with its scripted reply, and reports each call
/// as it arrives. A call with no reply scripted yet waits for one, so a
/// test can look at the worker mid-call.
pub struct FakeEngine {
    replies: Mutex<Script<Result<TwitchHelixResult, HostError>>>,
    liveness: Mutex<Script<Result<StreamLiveness, HostError>>>,
    calls: mpsc::UnboundedSender<EngineCall>,
    /// Signalled when a reply is scripted, for calls waiting on one.
    scripted: Notify,
}

impl FakeEngine {
    pub fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<EngineCall>) {
        let (calls, received) = mpsc::unbounded_channel();
        let engine = FakeEngine {
            replies: Script::new(),
            liveness: Script::new(),
            calls,
            scripted: Notify::new(),
        };
        (Arc::new(engine), received)
    }

    /// The reply to the next Twitch write (shoutout or marker) not yet
    /// scripted.
    pub fn reply(&self, reply: Result<TwitchHelixResult, HostError>) {
        self.push(&self.replies, reply);
    }

    /// The reply to the next `stream_liveness` call not yet scripted.
    pub fn live(&self, reply: Result<StreamLiveness, HostError>) {
        self.push(&self.liveness, reply);
    }

    /// The reply to `stream_liveness` call number `ticket`, counting from 0.
    pub fn live_for(&self, ticket: usize, reply: Result<StreamLiveness, HostError>) {
        let mut script = self.liveness.lock().expect("script lock");
        assert!(
            script.replies.insert(ticket, reply).is_none(),
            "call {ticket} already has a reply"
        );
        script.next_scripted = script.next_scripted.max(ticket + 1);
        drop(script);
        self.scripted.notify_waiters();
    }

    fn push<T>(&self, script: &Mutex<Script<T>>, reply: T) {
        let mut script = script.lock().expect("script lock");
        let ticket = script.next_scripted;
        script.next_scripted += 1;
        script.replies.insert(ticket, reply);
        drop(script);
        self.scripted.notify_waiters();
    }

    /// Takes the call's ticket now, as the call arrives, and waits for its
    /// reply.
    fn answer<'a, T: Send + 'a>(&'a self, script: &'a Mutex<Script<T>>) -> BoxFuture<'a, T> {
        let ticket = {
            let mut script = script.lock().expect("script lock");
            script.issued += 1;
            script.issued - 1
        };
        Box::pin(async move {
            loop {
                let notified = self.scripted.notified();
                if let Some(reply) = script.lock().expect("script lock").replies.remove(&ticket) {
                    return reply;
                }
                notified.await;
            }
        })
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
        self.answer(&self.replies)
    }

    fn create_stream_marker<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
        description: &'a str,
    ) -> BoxFuture<'a, Result<TwitchHelixResult, HostError>> {
        let _ = self
            .calls
            .send(EngineCall::CreateStreamMarker(description.to_string()));
        self.answer(&self.replies)
    }

    fn stream_liveness<'a>(
        &'a self,
        _credentials: &'a ClientCredentials,
    ) -> BoxFuture<'a, Result<StreamLiveness, HostError>> {
        let _ = self.calls.send(EngineCall::StreamLiveness);
        self.answer(&self.liveness)
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
