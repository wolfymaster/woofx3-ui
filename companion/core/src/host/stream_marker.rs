//! The go-live checklist's "Stream start" marker in local mode. Twitch marks
//! only a live broadcast, so a marker asked for before the stream starts
//! waits here until the engine reports the stream live, then is dropped.
//!
//! The host learns the stream went live by asking the engine's
//! `getStreamStatus` every poll interval while a request waits, and only
//! then: a request lasts at most the request window, so the polling is
//! bounded. Polling a level ("is it live?") rather than waiting for an
//! online edge cannot miss a stream that started between the request's own
//! check and the first poll. Like the shoutout queue, this is UI state kept
//! by the host, in memory. Must match the window in convex/lib/goLiveMarker.ts.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::gateway::{ClientCredentials, EngineGateway, TwitchHelixResult};
use super::registration::LocalSession;
use crate::clock::{millis, Clock, EpochMillis};

/// The marker's description on the VOD. Must match `MARKER_DESCRIPTION` in
/// convex/goLive.ts.
pub const MARKER_DESCRIPTION: &str = "Stream start";

#[derive(Debug, Clone)]
pub struct StreamMarkerOptions {
    /// How often the engine is asked whether the stream is live while a
    /// request waits. The marker lands up to this long after the start.
    pub poll_interval: Duration,
    /// How long a request waits for the stream. The checklist is run just
    /// before going live; a request older than this belongs to a stream
    /// that never happened, and marking a much later one "Stream start"
    /// would be wrong.
    pub request_window: Duration,
}

impl Default for StreamMarkerOptions {
    fn default() -> Self {
        StreamMarkerOptions {
            poll_interval: Duration::from_secs(15),
            request_window: Duration::from_secs(2 * 60 * 60),
        }
    }
}

/// Where the stream start marker stands. Times are [`EpochMillis`]. Must
/// match `StreamStartMarker` in companion/ui/src/host.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamStartMarker {
    /// Nothing is waiting: none was asked for, or the request window ended.
    Idle,
    #[serde(rename_all = "camelCase")]
    Pending { requested_at: EpochMillis },
    #[serde(rename_all = "camelCase")]
    Dropped { dropped_at: EpochMillis },
    /// Dropping a waiting marker failed once the stream was live.
    Failed { message: String },
}

/// The answer to asking for the marker, as the checklist reports each step.
/// Must match `GoLiveStepOutcome` in client/src/engine/types.ts, which also
/// has `skipped` for a step not asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MarkerRequestOutcome {
    Done,
    Queued { reason: String },
    Failed { message: String },
}

pub struct StreamMarkerRequests {
    state: watch::Sender<StreamStartMarker>,
    clock: Arc<dyn Clock>,
    options: StreamMarkerOptions,
}

impl StreamMarkerRequests {
    pub fn new(clock: Arc<dyn Clock>, options: StreamMarkerOptions) -> Self {
        StreamMarkerRequests {
            state: watch::Sender::new(StreamStartMarker::Idle),
            clock,
            options,
        }
    }

    pub fn current(&self) -> StreamStartMarker {
        self.state.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<StreamStartMarker> {
        self.state.subscribe()
    }

    /// Drops the marker now when the stream is live, else leaves it waiting
    /// for [`run_stream_marker`] to drop when it goes live. A second request
    /// while one waits restarts the window.
    pub async fn request(
        &self,
        gateway: &dyn EngineGateway,
        credentials: &ClientCredentials,
    ) -> MarkerRequestOutcome {
        let live = match gateway.is_live(credentials).await {
            Ok(live) => live,
            Err(err) => {
                return MarkerRequestOutcome::Failed {
                    message: err.to_string(),
                }
            }
        };
        if !live {
            self.state.send_replace(StreamStartMarker::Pending {
                requested_at: self.clock.now(),
            });
            return MarkerRequestOutcome::Queued {
                reason: "The marker will be dropped when your stream goes live.".to_string(),
            };
        }
        // An older request still waiting is answered by this marker, so the
        // watcher must not drop a second one.
        self.claim_pending();
        match drop_marker(gateway, credentials).await {
            Ok(()) => {
                self.state.send_replace(StreamStartMarker::Dropped {
                    dropped_at: self.clock.now(),
                });
                MarkerRequestOutcome::Done
            }
            Err(message) => MarkerRequestOutcome::Failed { message },
        }
    }

    /// Takes the waiting request, if there is one, so only one caller drops
    /// its marker.
    fn claim_pending(&self) -> bool {
        let mut claimed = false;
        self.state.send_if_modified(|state| {
            if matches!(state, StreamStartMarker::Pending { .. }) {
                *state = StreamStartMarker::Idle;
                claimed = true;
            }
            claimed
        });
        claimed
    }

    /// Ends the request made at `requested_at` when its window has passed;
    /// a newer request is left alone.
    fn expire(&self, requested_at: EpochMillis) {
        self.state.send_if_modified(|state| {
            if *state == (StreamStartMarker::Pending { requested_at }) {
                *state = StreamStartMarker::Idle;
                return true;
            }
            false
        });
    }
}

/// Watches for the stream going live while a marker waits, and drops it,
/// until cancelled or until the host's registration ends.
pub async fn run_stream_marker(
    requests: Arc<StreamMarkerRequests>,
    gateway: Arc<dyn EngineGateway>,
    mut session: watch::Receiver<LocalSession>,
    cancel: CancellationToken,
) {
    let mut pending = requests.subscribe();
    let window = millis(requests.options.request_window);
    let poll_interval = millis(requests.options.poll_interval);
    loop {
        let pending_since = match &*pending.borrow_and_update() {
            StreamStartMarker::Pending { requested_at } => Some(*requested_at),
            StreamStartMarker::Idle
            | StreamStartMarker::Dropped { .. }
            | StreamStartMarker::Failed { .. } => None,
        };
        let Some(requested_at) = pending_since else {
            tokio::select! {
                _ = cancel.cancelled() => return,
                changed = pending.changed() => if changed.is_err() { return; },
            }
            continue;
        };
        let expires_at = requested_at.saturating_add(window);
        let next_poll = requests
            .clock
            .now()
            .saturating_add(poll_interval)
            .min(expires_at);
        tokio::select! {
            _ = cancel.cancelled() => return,
            () = requests.clock.sleep_until(next_poll) => {}
        }
        // The registration has ended, so no session will come.
        if session.has_changed().is_err() {
            return;
        }
        if requests.clock.now() >= expires_at {
            requests.expire(requested_at);
            continue;
        }
        // Without a session there is nothing to ask; the next poll tries again.
        let credentials = match &*session.borrow_and_update() {
            LocalSession::Ready(credentials) => credentials.clone(),
            LocalSession::Starting | LocalSession::Failed { .. } => continue,
        };
        let live = tokio::select! {
            _ = cancel.cancelled() => return,
            live = gateway.is_live(&credentials) => live,
        };
        // An engine that could not answer is asked again at the next poll.
        if !matches!(live, Ok(true)) || !requests.claim_pending() {
            continue;
        }
        let dropped = tokio::select! {
            _ = cancel.cancelled() => return,
            dropped = drop_marker(gateway.as_ref(), &credentials) => dropped,
        };
        requests.state.send_replace(match dropped {
            Ok(()) => StreamStartMarker::Dropped {
                dropped_at: requests.clock.now(),
            },
            Err(message) => StreamStartMarker::Failed { message },
        });
    }
}

/// One marker, with the failure in the words the window shows.
async fn drop_marker(
    gateway: &dyn EngineGateway,
    credentials: &ClientCredentials,
) -> Result<(), String> {
    match gateway
        .create_stream_marker(credentials, MARKER_DESCRIPTION)
        .await
    {
        Ok(TwitchHelixResult::Ok) => Ok(()),
        Ok(TwitchHelixResult::Refused { status: 404, .. }) => {
            Err("Twitch only places markers on a live stream".to_string())
        }
        Ok(TwitchHelixResult::Refused { status, body }) => {
            Err(format!("Twitch stream marker failed: {status} {body}"))
        }
        Ok(TwitchHelixResult::Failed { code, error }) => Err(format!(
            "The engine could not drop the stream marker ({code}): {error}"
        )),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;
    use tokio::task::JoinHandle;

    use super::*;
    use crate::clock::fake::FakeClock;
    use crate::host::fake_engine::{ready_session, refused, EngineCall, FakeEngine};
    use crate::host::HostError;

    const START: EpochMillis = 5_000_000;
    const POLL: EpochMillis = 15_000;
    const WINDOW: EpochMillis = 2 * 60 * 60 * 1000;

    struct Harness {
        requests: Arc<StreamMarkerRequests>,
        clock: Arc<FakeClock>,
        sleeps: mpsc::UnboundedReceiver<EpochMillis>,
        engine: Arc<FakeEngine>,
        calls: mpsc::UnboundedReceiver<EngineCall>,
        session: watch::Sender<LocalSession>,
        cancel: CancellationToken,
        worker: JoinHandle<()>,
    }

    impl Harness {
        fn start() -> Self {
            let (clock, sleeps) = FakeClock::new(START);
            let clock = Arc::new(clock);
            let requests = Arc::new(StreamMarkerRequests::new(
                Arc::clone(&clock) as Arc<dyn Clock>,
                StreamMarkerOptions::default(),
            ));
            let (engine, calls) = FakeEngine::new();
            let (session, session_rx) = watch::channel(ready_session());
            let cancel = CancellationToken::new();
            let worker = tokio::spawn(run_stream_marker(
                Arc::clone(&requests),
                Arc::clone(&engine) as Arc<dyn EngineGateway>,
                session_rx,
                cancel.clone(),
            ));
            Harness {
                requests,
                clock,
                sleeps,
                engine,
                calls,
                session,
                cancel,
                worker,
            }
        }

        async fn request(&self) -> MarkerRequestOutcome {
            let credentials = match ready_session() {
                LocalSession::Ready(credentials) => credentials,
                _ => unreachable!(),
            };
            self.requests
                .request(self.engine.as_ref(), &credentials)
                .await
        }

        async fn next_call(&mut self) -> EngineCall {
            self.calls.recv().await.expect("the engine is called")
        }

        async fn next_sleep(&mut self) -> EpochMillis {
            self.sleeps.recv().await.expect("the worker sleeps")
        }

        async fn settled(&self, done: impl Fn(&StreamStartMarker) -> bool) -> StreamStartMarker {
            let mut state = self.requests.subscribe();
            let settled = state
                .wait_for(|state| done(state))
                .await
                .expect("the requests live");
            settled.clone()
        }

        async fn stop(self) {
            self.cancel.cancel();
            tokio::time::timeout(Duration::from_secs(5), self.worker)
                .await
                .expect("the worker stops when cancelled")
                .expect("the worker ends cleanly");
        }
    }

    #[tokio::test]
    async fn test_stream_marker_request_drops_at_once_while_live() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(true));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(harness.request().await, MarkerRequestOutcome::Done);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Dropped { dropped_at: START }
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_stream_marker_request_reports_a_refused_marker() {
        let harness = Harness::start();
        harness.engine.live(Ok(true));
        harness.engine.reply(refused(404, "not live"));
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: "Twitch only places markers on a live stream".into()
            }
        );
        harness.engine.live(Ok(true));
        harness.engine.reply(refused(401, "missing scope"));
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: "Twitch stream marker failed: 401 missing scope".into()
            }
        );
        assert_eq!(harness.requests.current(), StreamStartMarker::Idle);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_stream_marker_request_fails_when_the_engine_cannot_say() {
        let harness = Harness::start();
        harness.engine.live(Err(HostError::EngineHttpStatus(503)));
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: "the engine answered HTTP 503".into()
            }
        );
        assert_eq!(harness.requests.current(), StreamStartMarker::Idle);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_drops_a_waiting_marker_once_the_stream_is_live() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        assert!(matches!(
            harness.request().await,
            MarkerRequestOutcome::Queued { .. }
        ));
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Pending {
                requested_at: START
            }
        );

        // Still offline at the first poll.
        assert_eq!(harness.next_sleep().await, START + POLL);
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        harness.engine.live(Ok(false));

        // An engine that cannot answer is asked again.
        assert_eq!(harness.next_sleep().await, START + 2 * POLL);
        harness.clock.set(START + 2 * POLL);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        harness.engine.live(Err(HostError::EngineHttpStatus(502)));

        assert_eq!(harness.next_sleep().await, START + 3 * POLL);
        harness.clock.set(START + 3 * POLL);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        harness.engine.live(Ok(true));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );
        assert_eq!(
            harness
                .settled(|state| matches!(state, StreamStartMarker::Dropped { .. }))
                .await,
            StreamStartMarker::Dropped {
                dropped_at: START + 3 * POLL
            }
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_reports_a_marker_twitch_refused() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(harness.next_sleep().await, START + POLL);
        harness.clock.set(START + POLL);
        harness.engine.live(Ok(true));
        harness.engine.reply(Ok(TwitchHelixResult::Failed {
            code: crate::host::gateway::TwitchHelixFailure::Unavailable,
            error: "twitch service down".into(),
        }));
        assert_eq!(
            harness
                .settled(|state| matches!(state, StreamStartMarker::Failed { .. }))
                .await,
            StreamStartMarker::Failed {
                message:
                    "The engine could not drop the stream marker (unavailable): twitch service down"
                        .into()
            }
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_gives_up_when_the_stream_never_starts() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(harness.next_sleep().await, START + POLL);
        // The clock jumps past the window, as across a sleeping laptop.
        harness.clock.set(START + WINDOW + 1);
        assert_eq!(
            harness
                .settled(|state| *state == StreamStartMarker::Idle)
                .await,
            StreamStartMarker::Idle
        );
        assert!(harness.calls.try_recv().is_err(), "no poll past the window");
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_last_poll_lands_on_the_window_end() {
        let mut harness = Harness::start();
        harness.clock.set(START);
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(harness.next_sleep().await, START + POLL);
        harness.clock.set(START + WINDOW - 1);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        harness.engine.live(Ok(false));
        assert_eq!(harness.next_sleep().await, START + WINDOW);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_stream_marker_request_while_live_answers_a_waiting_one() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(harness.next_sleep().await, START + POLL);

        harness.engine.live(Ok(true));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(harness.request().await, MarkerRequestOutcome::Done);
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );

        // The watcher's poll finds nothing left to drop.
        harness.clock.set(START + POLL);
        harness.engine.live(Ok(true));
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        tokio::task::yield_now().await;
        assert!(harness.calls.try_recv().is_err(), "one marker only");
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_skips_a_poll_without_a_session() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_call().await, EngineCall::IsLive);
        assert_eq!(harness.next_sleep().await, START + POLL);
        harness.session.send_replace(LocalSession::Starting);
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_sleep().await, START + 2 * POLL);
        assert!(harness.calls.try_recv().is_err(), "no session, no poll");
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_stops_mid_wait() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_sleep().await, START + POLL);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_ends_with_the_registration() {
        let mut harness = Harness::start();
        harness.engine.live(Ok(false));
        harness.request().await;
        assert_eq!(harness.next_sleep().await, START + POLL);
        let Harness {
            session,
            clock,
            worker,
            ..
        } = harness;
        drop(session);
        clock.set(START + POLL);
        tokio::time::timeout(Duration::from_secs(5), worker)
            .await
            .expect("the worker ends with the registration")
            .expect("the worker ends cleanly");
    }

    #[test]
    fn test_stream_start_marker_serializes_as_the_typescript_mirror_expects() {
        let cases = [
            (
                StreamStartMarker::Idle,
                serde_json::json!({ "kind": "idle" }),
            ),
            (
                StreamStartMarker::Pending { requested_at: 7 },
                serde_json::json!({ "kind": "pending", "requestedAt": 7 }),
            ),
            (
                StreamStartMarker::Dropped { dropped_at: 8 },
                serde_json::json!({ "kind": "dropped", "droppedAt": 8 }),
            ),
            (
                StreamStartMarker::Failed {
                    message: "m".into(),
                },
                serde_json::json!({ "kind": "failed", "message": "m" }),
            ),
        ];
        for (state, wire) in cases {
            assert_eq!(serde_json::to_value(&state).expect("serializes"), wire);
        }
        let outcomes = [
            (
                MarkerRequestOutcome::Done,
                serde_json::json!({ "status": "done" }),
            ),
            (
                MarkerRequestOutcome::Queued { reason: "r".into() },
                serde_json::json!({ "status": "queued", "reason": "r" }),
            ),
            (
                MarkerRequestOutcome::Failed {
                    message: "m".into(),
                },
                serde_json::json!({ "status": "failed", "message": "m" }),
            ),
        ];
        for (outcome, wire) in outcomes {
            assert_eq!(serde_json::to_value(&outcome).expect("serializes"), wire);
        }
    }
}
