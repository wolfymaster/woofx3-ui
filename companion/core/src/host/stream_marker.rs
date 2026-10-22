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
//!
//! One request gets one marker. Whoever drops it, the request path or the
//! watcher, first moves the state to [`StreamStartMarker::Dropping`], and
//! every write is conditional on the state it expects, so a request made
//! while the stream is going live waits for the drop under way instead of
//! dropping a second marker.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::gateway::{ClientCredentials, EngineGateway, StreamLiveness, TwitchHelixResult};
use super::registration::{CredentialRefusals, LocalSession};
use super::HostError;
use crate::clock::{millis, Clock, EpochMillis};

/// The marker's description on the VOD. Must match `MARKER_DESCRIPTION` in
/// convex/goLive.ts.
pub const MARKER_DESCRIPTION: &str = "Stream start";

/// Why a request cannot tell whether the stream is live: the engine could
/// not ask Twitch, as when no account is linked or its token is refused.
const LIVENESS_UNKNOWN: &str =
    "Twitch could not be asked whether the stream is live. Check the Twitch connection.";

/// A drop whose outcome was never seen, because the host stopped mid-call.
const DROP_UNCONFIRMED: &str = "The host stopped before Twitch confirmed the stream marker.";

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
    /// The stream is live and the marker is being dropped.
    Dropping,
    #[serde(rename_all = "camelCase")]
    Dropped { dropped_at: EpochMillis },
    /// Twitch did not take the marker once the stream was live.
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

/// What a request finds when it goes to change the state.
enum Turn {
    /// Nobody is dropping a marker: the request may.
    Free,
    /// Another caller is dropping one now.
    DropUnderWay,
    /// A marker landed since the request began, so it answers the request.
    DroppedSince,
}

fn turn(state: &StreamStartMarker, request_began: EpochMillis) -> Turn {
    match state {
        StreamStartMarker::Dropping => Turn::DropUnderWay,
        StreamStartMarker::Dropped { dropped_at } if *dropped_at >= request_began => {
            Turn::DroppedSince
        }
        StreamStartMarker::Idle
        | StreamStartMarker::Pending { .. }
        | StreamStartMarker::Dropped { .. }
        | StreamStartMarker::Failed { .. } => Turn::Free,
    }
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

    /// The marker's state, with a request past its window ended first: no
    /// watcher runs while the engine is stopped, so time alone decides.
    pub fn current(&self) -> StreamStartMarker {
        self.expire_overdue();
        self.state.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<StreamStartMarker> {
        self.state.subscribe()
    }

    /// Drops the marker now when the stream is live, else leaves it waiting
    /// for [`run_stream_marker`] to drop when it goes live. A second request
    /// while one waits restarts the window. A request that finds a drop
    /// under way, or finished since it began, is answered by that marker.
    pub async fn request(
        &self,
        gateway: &dyn EngineGateway,
        credentials: &ClientCredentials,
    ) -> MarkerRequestOutcome {
        let began = self.clock.now();
        let liveness = match gateway.stream_liveness(credentials).await {
            Ok(liveness) => liveness,
            Err(err) => {
                return MarkerRequestOutcome::Failed {
                    message: err.to_string(),
                }
            }
        };
        let next = match liveness {
            StreamLiveness::Live => StreamStartMarker::Dropping,
            StreamLiveness::Offline => StreamStartMarker::Pending {
                requested_at: self.clock.now(),
            },
            StreamLiveness::Unknown => {
                return MarkerRequestOutcome::Failed {
                    message: LIVENESS_UNKNOWN.to_string(),
                }
            }
        };
        let dropping = next == StreamStartMarker::Dropping;
        let mut found = Turn::Free;
        self.state.send_if_modified(|state| {
            found = turn(state, began);
            if matches!(found, Turn::Free) {
                *state = next;
                return true;
            }
            false
        });
        match found {
            Turn::DroppedSince => MarkerRequestOutcome::Done,
            Turn::DropUnderWay => self.drop_outcome().await,
            Turn::Free if dropping => {
                let claim = DropClaim::taken(self);
                claim.finish(drop_marker(gateway, credentials).await)
            }
            Turn::Free => MarkerRequestOutcome::Queued {
                reason: "The marker will be dropped when your stream goes live.".to_string(),
            },
        }
    }

    /// Waits for a drop under way to end, and reports how it ended.
    async fn drop_outcome(&self) -> MarkerRequestOutcome {
        let mut state = self.state.subscribe();
        let ended = state
            .wait_for(|state| *state != StreamStartMarker::Dropping)
            .await
            .map(|ended| ended.clone());
        match ended {
            Ok(StreamStartMarker::Dropped { .. }) => MarkerRequestOutcome::Done,
            Ok(StreamStartMarker::Failed { message }) => MarkerRequestOutcome::Failed { message },
            // Overwritten by a newer request before this one looked.
            Ok(
                StreamStartMarker::Idle
                | StreamStartMarker::Pending { .. }
                | StreamStartMarker::Dropping,
            )
            | Err(_) => MarkerRequestOutcome::Failed {
                message: DROP_UNCONFIRMED.to_string(),
            },
        }
    }

    /// Takes the waiting request, so only one caller drops its marker.
    fn claim_pending(&self) -> Option<DropClaim<'_>> {
        let claimed = self.state.send_if_modified(|state| {
            if matches!(state, StreamStartMarker::Pending { .. }) {
                *state = StreamStartMarker::Dropping;
                return true;
            }
            false
        });
        claimed.then(|| DropClaim::taken(self))
    }

    /// Ends a waiting request whose window has passed.
    fn expire_overdue(&self) {
        let now = self.clock.now();
        let window = millis(self.options.request_window);
        self.state.send_if_modified(|state| match state {
            StreamStartMarker::Pending { requested_at }
                if now >= requested_at.saturating_add(window) =>
            {
                *state = StreamStartMarker::Idle;
                true
            }
            _ => false,
        });
    }
}

/// The right to drop the marker, held while the state is
/// [`StreamStartMarker::Dropping`]. Settles the state with the drop's
/// outcome, or, when dropped unfinished because its task was cancelled,
/// with a failure, so the state is never left `Dropping`.
struct DropClaim<'a> {
    requests: &'a StreamMarkerRequests,
    settled: bool,
}

impl<'a> DropClaim<'a> {
    fn taken(requests: &'a StreamMarkerRequests) -> Self {
        DropClaim {
            requests,
            settled: false,
        }
    }

    fn finish(mut self, dropped: Result<(), String>) -> MarkerRequestOutcome {
        let (next, outcome) = match dropped {
            Ok(()) => (
                StreamStartMarker::Dropped {
                    dropped_at: self.requests.clock.now(),
                },
                MarkerRequestOutcome::Done,
            ),
            Err(message) => (
                StreamStartMarker::Failed {
                    message: message.clone(),
                },
                MarkerRequestOutcome::Failed { message },
            ),
        };
        self.settle(next);
        outcome
    }

    fn settle(&mut self, next: StreamStartMarker) {
        self.settled = true;
        self.requests.state.send_if_modified(|state| {
            if *state == StreamStartMarker::Dropping {
                *state = next;
                return true;
            }
            false
        });
    }
}

impl Drop for DropClaim<'_> {
    fn drop(&mut self) {
        if !self.settled {
            self.settle(StreamStartMarker::Failed {
                message: DROP_UNCONFIRMED.to_string(),
            });
        }
    }
}

/// Watches for the stream going live while a marker waits, and drops it,
/// until cancelled or until the host's registration ends. A poll the
/// engine refuses the host's credentials for is reported to registration
/// through `refusals`.
pub async fn run_stream_marker(
    requests: Arc<StreamMarkerRequests>,
    gateway: Arc<dyn EngineGateway>,
    mut session: watch::Receiver<LocalSession>,
    refusals: CredentialRefusals,
    cancel: CancellationToken,
) {
    let mut pending = requests.subscribe();
    let window = millis(requests.options.request_window);
    let poll_interval = millis(requests.options.poll_interval);
    loop {
        // Also on start: a request may have outlived its window while the
        // engine was stopped.
        requests.expire_overdue();
        let pending_since = match &*pending.borrow_and_update() {
            StreamStartMarker::Pending { requested_at } => Some(*requested_at),
            StreamStartMarker::Idle
            | StreamStartMarker::Dropping
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
        // Expired, answered by a request's own marker, or replaced by a
        // newer request: start over from the current state.
        if requests.clock.now() >= expires_at
            || *requests.state.borrow() != (StreamStartMarker::Pending { requested_at })
        {
            continue;
        }
        // Without a session there is nothing to ask; the next poll tries again.
        let credentials = match &*session.borrow_and_update() {
            LocalSession::Ready(credentials) => credentials.clone(),
            LocalSession::Starting | LocalSession::Failed { .. } => continue,
        };
        let liveness = tokio::select! {
            _ = cancel.cancelled() => return,
            liveness = gateway.stream_liveness(&credentials) => liveness,
        };
        if matches!(liveness, Err(HostError::CredentialsRefused { .. })) {
            refusals.report();
        }
        // Offline, unknown, or an engine that could not answer: the next
        // poll asks again.
        if !matches!(liveness, Ok(StreamLiveness::Live)) {
            continue;
        }
        let Some(claim) = requests.claim_pending() else {
            continue;
        };
        let dropped = tokio::select! {
            _ = cancel.cancelled() => return,
            dropped = drop_marker(gateway.as_ref(), &credentials) => dropped,
        };
        claim.finish(dropped);
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

    fn credentials() -> ClientCredentials {
        match ready_session() {
            LocalSession::Ready(credentials) => credentials,
            other => panic!("ready_session gave {other:?}"),
        }
    }

    struct Harness {
        requests: Arc<StreamMarkerRequests>,
        clock: Arc<FakeClock>,
        sleeps: mpsc::UnboundedReceiver<EpochMillis>,
        engine: Arc<FakeEngine>,
        calls: mpsc::UnboundedReceiver<EngineCall>,
        session: watch::Sender<LocalSession>,
        refusals: CredentialRefusals,
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
            let refusals = CredentialRefusals::new();
            let cancel = CancellationToken::new();
            let worker = tokio::spawn(run_stream_marker(
                Arc::clone(&requests),
                Arc::clone(&engine) as Arc<dyn EngineGateway>,
                session_rx,
                refusals.clone(),
                cancel.clone(),
            ));
            Harness {
                requests,
                clock,
                sleeps,
                engine,
                calls,
                session,
                refusals,
                cancel,
                worker,
            }
        }

        async fn request(&self) -> MarkerRequestOutcome {
            self.requests
                .request(self.engine.as_ref(), &credentials())
                .await
        }

        /// A request running on its own task, so the test can act while it
        /// waits on the engine.
        fn spawn_request(&self) -> JoinHandle<MarkerRequestOutcome> {
            let requests = Arc::clone(&self.requests);
            let engine = Arc::clone(&self.engine);
            tokio::spawn(async move { requests.request(engine.as_ref(), &credentials()).await })
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

        /// Leaves a request pending from START, with the watcher asleep
        /// until the first poll.
        async fn pending(&mut self) {
            self.engine.live(Ok(StreamLiveness::Offline));
            assert!(matches!(
                self.request().await,
                MarkerRequestOutcome::Queued { .. }
            ));
            assert_eq!(self.next_call().await, EngineCall::StreamLiveness);
            assert_eq!(self.next_sleep().await, START + POLL);
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
        harness.engine.live(Ok(StreamLiveness::Live));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(harness.request().await, MarkerRequestOutcome::Done);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
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
    async fn test_stream_marker_request_reports_a_refused_marker_as_failed() {
        let harness = Harness::start();
        harness.engine.live(Ok(StreamLiveness::Live));
        harness.engine.reply(refused(404, "not live"));
        let message = "Twitch only places markers on a live stream".to_string();
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: message.clone()
            }
        );
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Failed { message }
        );

        harness.engine.live(Ok(StreamLiveness::Live));
        harness.engine.reply(refused(401, "missing scope"));
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: "Twitch stream marker failed: 401 missing scope".into()
            }
        );
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
    async fn test_stream_marker_request_fails_when_twitch_cannot_be_asked() {
        let harness = Harness::start();
        harness.engine.live(Ok(StreamLiveness::Unknown));
        assert_eq!(
            harness.request().await,
            MarkerRequestOutcome::Failed {
                message: LIVENESS_UNKNOWN.into()
            }
        );
        assert_eq!(harness.requests.current(), StreamStartMarker::Idle);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_drops_a_waiting_marker_once_the_stream_is_live() {
        let mut harness = Harness::start();
        harness.pending().await;
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Pending {
                requested_at: START
            }
        );

        // Still offline at the first poll.
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Offline));

        // An engine that cannot answer, or cannot ask Twitch, is asked again.
        assert_eq!(harness.next_sleep().await, START + 2 * POLL);
        harness.clock.set(START + 2 * POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Err(HostError::EngineHttpStatus(502)));

        assert_eq!(harness.next_sleep().await, START + 3 * POLL);
        harness.clock.set(START + 3 * POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Unknown));

        assert_eq!(harness.next_sleep().await, START + 4 * POLL);
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Pending {
                requested_at: START
            }
        );
        harness.clock.set(START + 4 * POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Live));
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
                dropped_at: START + 4 * POLL
            }
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_reports_a_marker_twitch_refused() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.clock.set(START + POLL);
        harness.engine.live(Ok(StreamLiveness::Live));
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
        harness.pending().await;
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
        harness.pending().await;
        harness.clock.set(START + WINDOW - 1);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Offline));
        assert_eq!(harness.next_sleep().await, START + WINDOW);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_stream_marker_pending_expires_without_a_watcher() {
        let (clock, _sleeps) = FakeClock::new(START);
        let clock = Arc::new(clock);
        let requests = StreamMarkerRequests::new(
            Arc::clone(&clock) as Arc<dyn Clock>,
            StreamMarkerOptions::default(),
        );
        let (engine, _calls) = FakeEngine::new();
        engine.live(Ok(StreamLiveness::Offline));
        requests.request(engine.as_ref(), &credentials()).await;
        clock.set(START + WINDOW - 1);
        assert_eq!(
            requests.current(),
            StreamStartMarker::Pending {
                requested_at: START
            }
        );
        clock.set(START + WINDOW);
        assert_eq!(requests.current(), StreamStartMarker::Idle);
    }

    #[tokio::test]
    async fn test_run_stream_marker_expires_an_overdue_request_on_start() {
        let (clock, mut sleeps) = FakeClock::new(START);
        let clock = Arc::new(clock);
        let requests = Arc::new(StreamMarkerRequests::new(
            Arc::clone(&clock) as Arc<dyn Clock>,
            StreamMarkerOptions::default(),
        ));
        let (engine, mut calls) = FakeEngine::new();
        engine.live(Ok(StreamLiveness::Offline));
        requests.request(engine.as_ref(), &credentials()).await;
        assert_eq!(calls.recv().await, Some(EngineCall::StreamLiveness));
        clock.set(START + WINDOW);

        let mut state = requests.subscribe();
        let (_session, session_rx) = watch::channel(ready_session());
        let cancel = CancellationToken::new();
        let worker = tokio::spawn(run_stream_marker(
            Arc::clone(&requests),
            engine as Arc<dyn EngineGateway>,
            session_rx,
            CredentialRefusals::new(),
            cancel.clone(),
        ));
        state
            .wait_for(|state| *state == StreamStartMarker::Idle)
            .await
            .expect("the requests live");
        assert!(sleeps.try_recv().is_err(), "no poll for an expired request");
        assert!(calls.try_recv().is_err());
        cancel.cancel();
        worker.await.expect("the worker ends cleanly");
    }

    #[tokio::test]
    async fn test_stream_marker_request_while_live_answers_a_waiting_one() {
        let mut harness = Harness::start();
        harness.pending().await;

        harness.engine.live(Ok(StreamLiveness::Live));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(harness.request().await, MarkerRequestOutcome::Done);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );

        // The watcher finds nothing left to drop and polls no more.
        harness.clock.set(START + POLL);
        tokio::task::yield_now().await;
        assert!(harness.calls.try_recv().is_err(), "one marker only");
        harness.stop().await;
    }

    /// The watcher is dropping the waiting request's marker when the
    /// checklist is run again: the new request waits for that marker
    /// instead of dropping a second one.
    #[tokio::test]
    async fn test_stream_marker_request_during_the_watchers_drop_shares_its_marker() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Live));
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );
        assert_eq!(harness.requests.current(), StreamStartMarker::Dropping);

        let second = harness.spawn_request();
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Ok(StreamLiveness::Live));
        tokio::task::yield_now().await;
        assert!(!second.is_finished(), "waits for the drop under way");
        assert!(
            harness.calls.try_recv().is_err(),
            "no second marker while the first is being dropped"
        );

        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), second)
                .await
                .expect("the request ends once the drop does")
                .expect("the request ends cleanly"),
            MarkerRequestOutcome::Done
        );
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Dropped {
                dropped_at: START + POLL
            }
        );
        assert!(harness.calls.try_recv().is_err(), "one marker only");
        harness.stop().await;
    }

    /// A request asks whether the stream is live just before it starts, and
    /// the watcher drops the waiting marker before that stale "offline"
    /// answer arrives: the request must not leave a new marker waiting.
    #[tokio::test]
    async fn test_stream_marker_request_with_a_stale_offline_answer_keeps_the_dropped_marker() {
        let mut harness = Harness::start();
        harness.pending().await;

        // Liveness call 1 is the second request's, call 2 the watcher's poll.
        let second = harness.spawn_request();
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live_for(2, Ok(StreamLiveness::Live));
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );
        harness
            .settled(|state| matches!(state, StreamStartMarker::Dropped { .. }))
            .await;

        harness.engine.live_for(1, Ok(StreamLiveness::Offline));
        assert_eq!(
            second.await.expect("the request ends"),
            MarkerRequestOutcome::Done
        );
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Dropped {
                dropped_at: START + POLL
            }
        );
        harness.clock.set(START + 3 * POLL);
        tokio::task::yield_now().await;
        assert!(harness.calls.try_recv().is_err(), "nothing left waiting");
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_reports_refused_credentials_to_registration() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        harness.engine.live(Err(HostError::CredentialsRefused {
            message: "AuthenticationRefused: client revoked".into(),
        }));
        tokio::time::timeout(Duration::from_secs(5), harness.refusals.reported())
            .await
            .expect("registration is told");
        // The request still waits, and the next poll asks again.
        assert_eq!(harness.next_sleep().await, START + 2 * POLL);
        assert_eq!(
            harness.requests.current(),
            StreamStartMarker::Pending {
                requested_at: START
            }
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_skips_a_poll_without_a_session() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.session.send_replace(LocalSession::Starting);
        harness.clock.set(START + POLL);
        assert_eq!(harness.next_sleep().await, START + 2 * POLL);
        assert!(harness.calls.try_recv().is_err(), "no session, no poll");
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_stops_mid_wait() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_stream_marker_stopped_mid_drop_leaves_no_drop_under_way() {
        let mut harness = Harness::start();
        harness.pending().await;
        harness.clock.set(START + POLL);
        harness.engine.live(Ok(StreamLiveness::Live));
        assert_eq!(harness.next_call().await, EngineCall::StreamLiveness);
        assert_eq!(
            harness.next_call().await,
            EngineCall::CreateStreamMarker(MARKER_DESCRIPTION.into())
        );
        let requests = Arc::clone(&harness.requests);
        harness.stop().await;
        assert_eq!(
            requests.current(),
            StreamStartMarker::Failed {
                message: DROP_UNCONFIRMED.into()
            }
        );
    }

    #[tokio::test]
    async fn test_run_stream_marker_ends_with_the_registration() {
        let mut harness = Harness::start();
        harness.pending().await;
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
                StreamStartMarker::Dropping,
                serde_json::json!({ "kind": "dropping" }),
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
