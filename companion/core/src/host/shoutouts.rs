//! The shoutout queue a local-mode host keeps for its window: channels
//! waiting for a Twitch shoutout, and the worker that sends them through the
//! local engine one at a time within Twitch's limits.
//!
//! In a cloud deployment the dashboard's backend keeps this queue. In local
//! mode it is the host's, not the engine's: it is UI state, so it lives here,
//! in memory, and is lost when the app quits.
//!
//! Twitch allows one shoutout per broadcaster every 2 minutes, refuses a
//! channel shouted out within the last hour, and refuses while either
//! channel is offline. So sends are paced from the last attempt, successful
//! or not, and a refused entry backs off on its own while the ones behind it
//! carry on. Nothing gives up on an entry: it waits until it is sent or
//! removed by hand. Must match the pacing in convex/lib/shoutoutSchedule.ts.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::gateway::{ClientCredentials, EngineGateway, TwitchHelixResult};
use super::registration::{CredentialRefusals, LocalSession};
use super::HostError;
use crate::backoff::Backoff;
use crate::clock::{millis, Clock, EpochMillis};

/// Pacing and limits. Defaults match Twitch's limits and the cloud queue.
#[derive(Debug, Clone)]
pub struct ShoutoutOptions {
    /// The least time between two attempts.
    pub cooldown: Duration,
    /// How long an entry waits after its n-th failure: `ceiling(n - 1)`.
    /// Never jittered: one queue per host has no herd to spread out.
    pub retry: Backoff,
    /// The most entries the queue holds.
    pub max_entries: usize,
}

impl Default for ShoutoutOptions {
    fn default() -> Self {
        ShoutoutOptions {
            cooldown: Duration::from_secs(120),
            retry: Backoff {
                initial: Duration::from_secs(120),
                max: Duration::from_secs(15 * 60),
            },
            max_entries: 200,
        }
    }
}

/// An entry's id, unique for the life of the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ShoutoutEntryId(pub u64);

/// The channel to shout out, as the window looked it up. Must match
/// `ShoutoutChannel` in companion/ui/src/host.ts.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoutoutChannel {
    pub twitch_user_id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: Option<String>,
    /// `partner`, `affiliate`, or empty for neither.
    pub broadcaster_type: Option<String>,
}

/// A channel waiting in the queue. Times are [`EpochMillis`]. Must match
/// `ShoutoutEntry` in companion/ui/src/host.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoutoutEntry {
    pub id: ShoutoutEntryId,
    pub twitch_user_id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: Option<String>,
    pub broadcaster_type: Option<String>,
    pub attempts: u32,
    /// Not tried again before this.
    pub next_eligible_at: EpochMillis,
    pub last_error: Option<String>,
}

/// What enqueueing did. Must match `ShoutoutEnqueued` in
/// companion/ui/src/host.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoutoutEnqueued {
    pub id: ShoutoutEntryId,
    /// 1-based, in queue order.
    pub position: usize,
    /// The channel was already waiting, so it kept its place.
    pub already_queued: bool,
}

#[derive(Debug, Default)]
struct QueueState {
    /// In queue order.
    entries: Vec<ShoutoutEntry>,
    next_id: u64,
    last_attempt_at: Option<EpochMillis>,
    /// Why the worker is holding every send, if it is.
    paused: Option<String>,
}

/// Why the queue holds its sends after the engine refused the host's own
/// credentials, until registration has given it a session again.
const PAUSED_FOR_CREDENTIALS: &str =
    "The engine refused this app's credentials. Shoutouts resume once the app has registered with it again.";

/// The queue as the window shows it. Must match `ShoutoutQueueView` in
/// companion/ui/src/host.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoutoutQueueView {
    /// In queue order.
    pub entries: Vec<ShoutoutEntry>,
    /// Why no shoutout is being sent, while none can be; null otherwise.
    pub paused_reason: Option<String>,
}

impl QueueState {
    fn view(&self) -> ShoutoutQueueView {
        ShoutoutQueueView {
            entries: self.entries.clone(),
            paused_reason: self.paused.clone(),
        }
    }
}

/// How one send went, as the queue records it.
#[derive(Debug, PartialEq, Eq)]
enum Attempt {
    Sent,
    /// The entry backs off, with the reason the window shows.
    Failed(String),
    /// The engine refused the host's own credentials. Not the entry's
    /// fault, so it counts only for pacing; the worker reports it to
    /// registration and holds every send until a new session comes.
    HostRefused,
}

/// What the pacing worker does next.
#[derive(Debug, PartialEq, Eq)]
enum Step {
    /// Nothing is queued.
    Idle,
    WaitUntil(EpochMillis),
    Send {
        id: ShoutoutEntryId,
        twitch_user_id: String,
    },
}

/// The queue's state, behind one watch so every change wakes the worker
/// and anyone following the queue, and readers never see half an edit.
pub struct ShoutoutQueue {
    state: watch::Sender<QueueState>,
    clock: Arc<dyn Clock>,
    options: ShoutoutOptions,
}

/// Follows the queue: [`ShoutoutQueueWatch::changed`] resolves after each
/// edit and each attempt.
pub struct ShoutoutQueueWatch(watch::Receiver<QueueState>);

impl ShoutoutQueueWatch {
    /// The queue now, marking it seen.
    pub fn view(&mut self) -> ShoutoutQueueView {
        self.0.borrow_and_update().view()
    }

    /// Fails only once the queue is gone.
    pub async fn changed(&mut self) -> Result<(), watch::error::RecvError> {
        self.0.changed().await
    }
}

impl ShoutoutQueue {
    pub fn new(clock: Arc<dyn Clock>, options: ShoutoutOptions) -> Self {
        ShoutoutQueue {
            state: watch::Sender::new(QueueState::default()),
            clock,
            options,
        }
    }

    pub fn subscribe(&self) -> ShoutoutQueueWatch {
        ShoutoutQueueWatch(self.state.subscribe())
    }

    /// In queue order.
    pub fn entries(&self) -> Vec<ShoutoutEntry> {
        self.state.borrow().entries.clone()
    }

    pub fn view(&self) -> ShoutoutQueueView {
        self.state.borrow().view()
    }

    fn set_paused(&self, reason: Option<&str>) {
        self.state.send_if_modified(|state| {
            if state.paused.as_deref() == reason {
                return false;
            }
            state.paused = reason.map(str::to_string);
            true
        });
    }

    /// Adds `channel` at the end, due at once. A channel already waiting
    /// keeps its place, so a raid and a `!so` for the same raider do not
    /// queue them twice.
    pub fn enqueue(&self, channel: ShoutoutChannel) -> Result<ShoutoutEnqueued, HostError> {
        let twitch_user_id = channel.twitch_user_id.trim().to_string();
        if twitch_user_id.is_empty() {
            return Err(HostError::ShoutoutChannelInvalid("twitchUserId is empty"));
        }
        let login = normalize_login(&channel.login);
        if login.is_empty() {
            return Err(HostError::ShoutoutChannelInvalid("login is empty"));
        }
        let display_name = match channel.display_name.trim() {
            "" => login.clone(),
            name => name.to_string(),
        };
        let now = self.clock.now();
        let max_entries = self.options.max_entries;
        let mut outcome = Err(HostError::ShoutoutQueueFull(max_entries));
        self.state.send_if_modified(|state| {
            if let Some(index) = state
                .entries
                .iter()
                .position(|entry| entry.twitch_user_id == twitch_user_id)
            {
                outcome = Ok(ShoutoutEnqueued {
                    id: state.entries[index].id,
                    position: index + 1,
                    already_queued: true,
                });
                return false;
            }
            if state.entries.len() >= max_entries {
                return false;
            }
            let id = ShoutoutEntryId(state.next_id);
            state.next_id += 1;
            state.entries.push(ShoutoutEntry {
                id,
                twitch_user_id,
                login,
                display_name,
                profile_image_url: channel.profile_image_url,
                broadcaster_type: channel.broadcaster_type,
                attempts: 0,
                next_eligible_at: now,
                last_error: None,
            });
            outcome = Ok(ShoutoutEnqueued {
                id,
                position: state.entries.len(),
                already_queued: false,
            });
            true
        });
        outcome
    }

    pub fn remove(&self, id: ShoutoutEntryId) -> Result<(), HostError> {
        let mut removed = false;
        self.state.send_if_modified(|state| {
            let before = state.entries.len();
            state.entries.retain(|entry| entry.id != id);
            removed = state.entries.len() != before;
            removed
        });
        if removed {
            Ok(())
        } else {
            Err(HostError::ShoutoutEntryNotFound(id.0))
        }
    }

    /// Puts the entries `ids` names first, in that order. An id no longer
    /// queued is skipped, since it may have been sent or removed while the
    /// window was dragging; entries `ids` leaves out follow, in their order.
    pub fn reorder(&self, ids: &[ShoutoutEntryId]) {
        self.state.send_if_modified(|state| {
            let before: Vec<ShoutoutEntryId> = state.entries.iter().map(|entry| entry.id).collect();
            let mut rest = std::mem::take(&mut state.entries);
            let mut ordered = Vec::with_capacity(rest.len());
            for id in ids {
                if let Some(index) = rest.iter().position(|entry| entry.id == *id) {
                    ordered.push(rest.remove(index));
                }
            }
            ordered.append(&mut rest);
            let changed = ordered.iter().map(|entry| entry.id).ne(before);
            state.entries = ordered;
            changed
        });
    }

    fn next_step(&self, now: EpochMillis) -> Step {
        let state = self.state.borrow();
        let Some(soonest) = state
            .entries
            .iter()
            .map(|entry| entry.next_eligible_at)
            .min()
        else {
            return Step::Idle;
        };
        if let Some(last) = state.last_attempt_at {
            let send_at = last.saturating_add(millis(self.options.cooldown));
            if send_at > now {
                return Step::WaitUntil(send_at);
            }
        }
        // The first due entry in queue order: one still backing off never
        // holds up the ones behind it.
        match state
            .entries
            .iter()
            .find(|entry| entry.next_eligible_at <= now)
        {
            Some(entry) => Step::Send {
                id: entry.id,
                twitch_user_id: entry.twitch_user_id.clone(),
            },
            None => Step::WaitUntil(soonest),
        }
    }

    /// Records an attempt made at `at`: a sent entry leaves the queue, a
    /// failed one backs off. An entry removed while its attempt was in
    /// flight is left removed.
    fn record_attempt(&self, id: ShoutoutEntryId, at: EpochMillis, outcome: Attempt) {
        let retry = self.options.retry;
        self.state.send_modify(|state| {
            state.last_attempt_at = Some(at);
            let Some(index) = state.entries.iter().position(|entry| entry.id == id) else {
                return;
            };
            match outcome {
                Attempt::Sent => {
                    state.entries.remove(index);
                }
                Attempt::HostRefused => {}
                Attempt::Failed(message) => {
                    let entry = &mut state.entries[index];
                    entry.attempts = entry.attempts.saturating_add(1);
                    entry.next_eligible_at =
                        at.saturating_add(millis(retry.ceiling(entry.attempts - 1)));
                    entry.last_error = Some(message);
                }
            }
        });
    }
}

/// Twitch logins are lowercase and typed with or without an `@`.
fn normalize_login(login: &str) -> String {
    let trimmed = login.trim();
    trimmed
        .strip_prefix('@')
        .unwrap_or(trimmed)
        .trim()
        .to_lowercase()
}

/// Sends queued shoutouts through the engine, one per cooldown, until
/// cancelled or until the host's registration ends. Waits while the host
/// has no engine session, without counting that against any entry. When
/// the engine refuses the host's credentials, it asks registration to
/// check them through `refusals`, and the queue shows why it is paused
/// until a new session comes.
pub async fn run_shoutout_pacing(
    queue: Arc<ShoutoutQueue>,
    gateway: Arc<dyn EngineGateway>,
    mut session: watch::Receiver<LocalSession>,
    refusals: CredentialRefusals,
    cancel: CancellationToken,
) {
    let mut changes = queue.state.subscribe();
    loop {
        let credentials = tokio::select! {
            _ = cancel.cancelled() => return,
            credentials = ready_credentials(&mut session) => match credentials {
                Some(credentials) => credentials,
                None => return,
            },
        };
        queue.set_paused(None);
        changes.borrow_and_update();
        let now = queue.clock.now();
        match queue.next_step(now) {
            Step::Idle => {
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    changed = changes.changed() => if changed.is_err() { return; },
                }
            }
            Step::WaitUntil(at) => {
                // An edit can make an entry due sooner, so it ends the wait.
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    () = queue.clock.sleep_until(at) => {}
                    changed = changes.changed() => if changed.is_err() { return; },
                }
            }
            Step::Send { id, twitch_user_id } => {
                // Cancelled mid-send, the entry stays queued and the attempt
                // unrecorded, though the engine may still complete the send.
                // A resend within the hour is refused by Twitch; one after
                // that would shout the channel out again.
                let outcome = tokio::select! {
                    _ = cancel.cancelled() => return,
                    sent = send(gateway.as_ref(), &credentials, &twitch_user_id) => sent,
                };
                let host_refused = outcome == Attempt::HostRefused;
                queue.record_attempt(id, now, outcome);
                if host_refused {
                    queue.set_paused(Some(PAUSED_FOR_CREDENTIALS));
                    refusals.report();
                    tokio::select! {
                        _ = cancel.cancelled() => return,
                        changed = session.changed() => if changed.is_err() { return; },
                    }
                }
            }
        }
    }
}

/// The session's credentials once it has them; `None` once registration
/// has ended.
async fn ready_credentials(
    session: &mut watch::Receiver<LocalSession>,
) -> Option<ClientCredentials> {
    loop {
        if let LocalSession::Ready(credentials) = &*session.borrow_and_update() {
            return Some(credentials.clone());
        }
        session.changed().await.ok()?;
    }
}

/// One shoutout, with the failure in the words the window shows.
async fn send(
    gateway: &dyn EngineGateway,
    credentials: &ClientCredentials,
    to_broadcaster_id: &str,
) -> Attempt {
    match gateway.send_shoutout(credentials, to_broadcaster_id).await {
        Ok(TwitchHelixResult::Ok) => Attempt::Sent,
        Ok(TwitchHelixResult::Refused { status: 429, .. }) => {
            Attempt::Failed("Twitch is rate-limiting shoutouts".to_string())
        }
        // The common refusal is a channel that is not live; Twitch's body
        // says which.
        Ok(TwitchHelixResult::Refused { status, body }) => {
            Attempt::Failed(format!("Twitch shoutout failed: {status} {body}"))
        }
        Ok(TwitchHelixResult::Failed { code, error }) => Attempt::Failed(format!(
            "The engine could not send the shoutout ({code}): {error}"
        )),
        Err(HostError::CredentialsRefused { .. }) => Attempt::HostRefused,
        Err(err) => Attempt::Failed(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;
    use tokio::task::JoinHandle;

    use super::*;
    use crate::clock::fake::FakeClock;
    use crate::host::fake_engine::{
        credentials, ready_session, refused, EngineCall, FakeEngine, MemoryCredentialStore,
    };
    use crate::host::registration::{
        run_registration, CredentialStore, Registrar, RegistrationOptions,
    };
    use crate::host::sidecar::{EnginePhase, EngineStatus};

    const START: EpochMillis = 1_000_000;
    const COOLDOWN: EpochMillis = 120_000;

    fn channel(id: &str) -> ShoutoutChannel {
        ShoutoutChannel {
            twitch_user_id: id.to_string(),
            login: format!("@{}", id.to_uppercase()),
            display_name: id.to_string(),
            profile_image_url: None,
            broadcaster_type: None,
        }
    }

    fn queue_at(start: EpochMillis) -> (Arc<ShoutoutQueue>, Arc<FakeClock>) {
        let (clock, _sleeps) = FakeClock::new(start);
        let clock = Arc::new(clock);
        let queue = Arc::new(ShoutoutQueue::new(
            Arc::clone(&clock) as Arc<dyn Clock>,
            ShoutoutOptions::default(),
        ));
        (queue, clock)
    }

    fn ids(queue: &ShoutoutQueue) -> Vec<String> {
        queue
            .entries()
            .into_iter()
            .map(|entry| entry.twitch_user_id)
            .collect()
    }

    /// The queue, its clock, the fake engine and the running worker.
    struct Harness {
        queue: Arc<ShoutoutQueue>,
        clock: Arc<FakeClock>,
        sleeps: mpsc::UnboundedReceiver<EpochMillis>,
        engine: Arc<FakeEngine>,
        calls: mpsc::UnboundedReceiver<EngineCall>,
        session: watch::Sender<LocalSession>,
        cancel: CancellationToken,
        worker: JoinHandle<()>,
    }

    impl Harness {
        fn start(session: LocalSession) -> Self {
            let (clock, sleeps) = FakeClock::new(START);
            let clock = Arc::new(clock);
            let queue = Arc::new(ShoutoutQueue::new(
                Arc::clone(&clock) as Arc<dyn Clock>,
                ShoutoutOptions::default(),
            ));
            let (engine, calls) = FakeEngine::new();
            let (session, session_rx) = watch::channel(session);
            let cancel = CancellationToken::new();
            let worker = tokio::spawn(run_shoutout_pacing(
                Arc::clone(&queue),
                Arc::clone(&engine) as Arc<dyn EngineGateway>,
                session_rx,
                CredentialRefusals::new(),
                cancel.clone(),
            ));
            Harness {
                queue,
                clock,
                sleeps,
                engine,
                calls,
                session,
                cancel,
                worker,
            }
        }

        async fn next_call(&mut self) -> EngineCall {
            self.calls
                .recv()
                .await
                .expect("the worker calls the engine")
        }

        /// Waits for the worker to sleep, and returns until when.
        async fn next_sleep(&mut self) -> EpochMillis {
            self.sleeps.recv().await.expect("the worker sleeps")
        }

        /// Waits until the worker has recorded an attempt on `id`.
        async fn attempted(&self, id: &str, attempts_or_gone: impl Fn(Option<u32>) -> bool) {
            let mut watch = self.queue.subscribe();
            loop {
                let attempts = watch
                    .view()
                    .entries
                    .into_iter()
                    .find(|entry| entry.twitch_user_id == id)
                    .map(|entry| entry.attempts);
                if attempts_or_gone(attempts) {
                    return;
                }
                watch.changed().await.expect("the queue lives");
            }
        }

        async fn stop(self) {
            self.cancel.cancel();
            tokio::time::timeout(Duration::from_secs(5), self.worker)
                .await
                .expect("the worker stops when cancelled")
                .expect("the worker ends cleanly");
        }
    }

    #[test]
    fn test_shoutout_queue_enqueue_normalizes_and_keeps_a_waiting_channel_in_place() {
        let (queue, _clock) = queue_at(START);
        let first = queue.enqueue(channel("a")).expect("queued");
        assert_eq!(
            first,
            ShoutoutEnqueued {
                id: ShoutoutEntryId(0),
                position: 1,
                already_queued: false
            }
        );
        queue.enqueue(channel("b")).expect("queued");
        let again = queue.enqueue(channel("a")).expect("still queued");
        assert_eq!(
            again,
            ShoutoutEnqueued {
                id: ShoutoutEntryId(0),
                position: 1,
                already_queued: true
            }
        );
        let entries = queue.entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].login, "a");
        assert_eq!(entries[0].next_eligible_at, START);
        assert_eq!(entries[0].attempts, 0);
    }

    #[test]
    fn test_shoutout_queue_enqueue_refuses_an_invalid_channel() {
        let (queue, _clock) = queue_at(START);
        let cases = [
            ("", "login", "twitchUserId is empty"),
            ("  ", "login", "twitchUserId is empty"),
            ("1", "", "login is empty"),
            ("1", " @ ", "login is empty"),
        ];
        for (twitch_user_id, login, reason) in cases {
            let err = queue
                .enqueue(ShoutoutChannel {
                    twitch_user_id: twitch_user_id.to_string(),
                    login: login.to_string(),
                    display_name: String::new(),
                    profile_image_url: None,
                    broadcaster_type: None,
                })
                .expect_err("refused");
            assert!(
                matches!(err, HostError::ShoutoutChannelInvalid(why) if why == reason),
                "{twitch_user_id:?} {login:?}: {err:?}"
            );
        }
        assert!(queue.entries().is_empty());
    }

    #[test]
    fn test_shoutout_queue_enqueue_names_a_channel_by_login_without_a_display_name() {
        let (queue, _clock) = queue_at(START);
        let mut nameless = channel("a");
        nameless.display_name = " ".to_string();
        queue.enqueue(nameless).expect("queued");
        assert_eq!(queue.entries()[0].display_name, "a");
    }

    #[test]
    fn test_shoutout_queue_enqueue_refuses_past_the_limit() {
        let (clock, _sleeps) = FakeClock::new(START);
        let queue = ShoutoutQueue::new(
            Arc::new(clock),
            ShoutoutOptions {
                max_entries: 2,
                ..ShoutoutOptions::default()
            },
        );
        queue.enqueue(channel("a")).expect("queued");
        queue.enqueue(channel("b")).expect("queued");
        assert!(matches!(
            queue.enqueue(channel("c")),
            Err(HostError::ShoutoutQueueFull(2))
        ));
        // A channel already waiting is still answered when the queue is full.
        assert!(queue.enqueue(channel("a")).expect("waiting").already_queued);
    }

    #[test]
    fn test_shoutout_queue_remove_fails_for_an_unknown_entry() {
        let (queue, _clock) = queue_at(START);
        let queued = queue.enqueue(channel("a")).expect("queued");
        queue.remove(queued.id).expect("removed");
        assert!(queue.entries().is_empty());
        assert!(matches!(
            queue.remove(queued.id),
            Err(HostError::ShoutoutEntryNotFound(0))
        ));
    }

    #[test]
    fn test_shoutout_queue_reorder_skips_gone_entries_and_keeps_unnamed_ones() {
        let (queue, _clock) = queue_at(START);
        for id in ["a", "b", "c", "d"] {
            queue.enqueue(channel(id)).expect("queued");
        }
        queue.reorder(&[
            ShoutoutEntryId(2),
            ShoutoutEntryId(99),
            ShoutoutEntryId(0),
            ShoutoutEntryId(2),
        ]);
        assert_eq!(ids(&queue), ["c", "a", "b", "d"]);
    }

    #[test]
    fn test_shoutout_queue_reorder_to_the_same_order_tells_nobody() {
        let (queue, _clock) = queue_at(START);
        queue.enqueue(channel("a")).expect("queued");
        queue.enqueue(channel("b")).expect("queued");
        let mut watch = queue.subscribe();
        watch.view();
        queue.reorder(&[ShoutoutEntryId(0), ShoutoutEntryId(1)]);
        assert!(!watch.0.has_changed().expect("the queue lives"));
        queue.reorder(&[ShoutoutEntryId(1)]);
        assert!(watch.0.has_changed().expect("the queue lives"));
        assert_eq!(ids(&queue), ["b", "a"]);
    }

    #[test]
    fn test_shoutout_queue_next_step_paces_and_skips_entries_backing_off() {
        let (queue, _clock) = queue_at(START);
        assert_eq!(queue.next_step(START), Step::Idle);
        queue.enqueue(channel("a")).expect("queued");
        queue.enqueue(channel("b")).expect("queued");
        assert_eq!(
            queue.next_step(START),
            Step::Send {
                id: ShoutoutEntryId(0),
                twitch_user_id: "a".to_string()
            }
        );
        queue.record_attempt(
            ShoutoutEntryId(0),
            START,
            Attempt::Failed("offline".to_string()),
        );
        assert_eq!(
            queue.next_step(START + 1),
            Step::WaitUntil(START + COOLDOWN)
        );
        // The first backoff is as long as the cooldown, so "a" is due again
        // first; its second backoff is longer.
        assert_eq!(
            queue.next_step(START + COOLDOWN),
            Step::Send {
                id: ShoutoutEntryId(0),
                twitch_user_id: "a".to_string()
            }
        );
        queue.record_attempt(
            ShoutoutEntryId(0),
            START + COOLDOWN,
            Attempt::Failed("offline".to_string()),
        );
        // After the next cooldown, "a" is still backing off, so "b" goes.
        assert_eq!(
            queue.next_step(START + 2 * COOLDOWN),
            Step::Send {
                id: ShoutoutEntryId(1),
                twitch_user_id: "b".to_string()
            }
        );
        queue.record_attempt(ShoutoutEntryId(1), START + 2 * COOLDOWN, Attempt::Sent);
        let a = &queue.entries()[0];
        assert_eq!(a.attempts, 2);
        assert_eq!(a.next_eligible_at, START + COOLDOWN + 240_000);
        assert_eq!(a.last_error.as_deref(), Some("offline"));
        assert_eq!(
            queue.next_step(START + 3 * COOLDOWN),
            Step::Send {
                id: ShoutoutEntryId(0),
                twitch_user_id: "a".to_string()
            }
        );
    }

    #[test]
    fn test_shoutout_queue_retry_delay_doubles_up_to_fifteen_minutes() {
        let (queue, _clock) = queue_at(START);
        queue.enqueue(channel("a")).expect("queued");
        let expected = [120_000, 240_000, 480_000, 900_000, 900_000];
        for (attempt, delay) in expected.into_iter().enumerate() {
            let at = START + attempt as u64 * 10_000_000;
            queue.record_attempt(ShoutoutEntryId(0), at, Attempt::Failed("no".to_string()));
            let entry = &queue.entries()[0];
            assert_eq!(
                entry.next_eligible_at - at,
                delay,
                "attempt {}",
                attempt + 1
            );
        }
    }

    #[test]
    fn test_shoutout_queue_records_an_attempt_on_a_removed_entry_as_pacing_only() {
        let (queue, _clock) = queue_at(START);
        let queued = queue.enqueue(channel("a")).expect("queued");
        queue.enqueue(channel("b")).expect("queued");
        queue.remove(queued.id).expect("removed");
        queue.record_attempt(queued.id, START, Attempt::Failed("late".to_string()));
        assert_eq!(ids(&queue), ["b"]);
        assert_eq!(queue.next_step(START), Step::WaitUntil(START + COOLDOWN));
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_sends_one_per_cooldown() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        harness.queue.enqueue(channel("b")).expect("queued");

        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("a", |attempts| attempts.is_none()).await;

        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        assert!(
            harness.calls.try_recv().is_err(),
            "nothing sent inside the cooldown"
        );
        harness.clock.set(START + COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("b".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("b", |attempts| attempts.is_none()).await;
        assert!(harness.queue.entries().is_empty());
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_backs_off_an_engine_refusal_and_sends_the_next() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        harness.queue.enqueue(channel("b")).expect("queued");

        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Err(HostError::EngineRefused {
            name: "Error".into(),
            message: "twitch service down".into(),
        }));
        harness.attempted("a", |attempts| attempts == Some(1)).await;
        let a = &harness.queue.entries()[0];
        assert_eq!(
            a.last_error.as_deref(),
            Some("the engine refused: Error: twitch service down")
        );

        // Due again first, refused again, and then backing off past the
        // next cooldown, so "b" goes next.
        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        harness.clock.set(START + COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Err(HostError::EngineHttpStatus(500)));
        harness.attempted("a", |attempts| attempts == Some(2)).await;
        assert_eq!(harness.next_sleep().await, START + 2 * COOLDOWN);
        harness.clock.set(START + 2 * COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("b".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("b", |attempts| attempts.is_none()).await;
        assert_eq!(ids(&harness.queue), ["a"]);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_retries_a_channel_that_was_offline() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");

        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(refused(
            400,
            "{\"message\":\"The broadcaster is not streaming live\"}",
        ));
        harness.attempted("a", |attempts| attempts == Some(1)).await;
        assert_eq!(
            harness.queue.entries()[0].last_error.as_deref(),
            Some("Twitch shoutout failed: 400 {\"message\":\"The broadcaster is not streaming live\"}")
        );

        // The cooldown and the entry's own backoff end together here.
        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        harness.clock.set(START + COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("a", |attempts| attempts.is_none()).await;
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_reports_twitch_rate_limiting_and_engine_failures() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(refused(429, ""));
        harness.attempted("a", |attempts| attempts == Some(1)).await;
        assert_eq!(
            harness.queue.entries()[0].last_error.as_deref(),
            Some("Twitch is rate-limiting shoutouts")
        );

        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        harness.clock.set(START + COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Failed {
            code: crate::host::gateway::TwitchHelixFailure::NotLinked,
            error: "no Twitch account".into(),
        }));
        harness.attempted("a", |attempts| attempts == Some(2)).await;
        assert_eq!(
            harness.queue.entries()[0].last_error.as_deref(),
            Some("The engine could not send the shoutout (not_linked): no Twitch account")
        );
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_wakes_for_an_entry_enqueued_while_waiting() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(refused(400, "offline"));
        harness.attempted("a", |attempts| attempts == Some(1)).await;
        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        harness.clock.set(START + COOLDOWN);
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(refused(400, "offline"));
        harness.attempted("a", |attempts| attempts == Some(2)).await;
        assert_eq!(harness.next_sleep().await, START + 2 * COOLDOWN);

        // Past the cooldown but inside "a"'s second backoff, the worker
        // waits on "a", until "b" arrives due at once.
        harness.clock.set(START + 2 * COOLDOWN);
        assert_eq!(harness.next_sleep().await, START + COOLDOWN + 240_000);
        harness.queue.enqueue(channel("b")).expect("queued");
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("b".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("b", |attempts| attempts.is_none()).await;
        assert_eq!(harness.queue.entries()[0].twitch_user_id, "a");
        harness.stop().await;
    }

    /// The engine revokes the host's client while it runs: the entry is not
    /// charged, the queue says why it is paused, and registration, told
    /// of the refusal, registers again so the queue resumes on its own.
    #[tokio::test]
    async fn test_run_shoutout_pacing_recovers_from_refused_credentials_through_registration() {
        let (clock, mut sleeps) = FakeClock::new(START);
        let clock = Arc::new(clock);
        let queue = Arc::new(ShoutoutQueue::new(
            Arc::clone(&clock) as Arc<dyn Clock>,
            ShoutoutOptions::default(),
        ));
        let (engine, mut calls) = FakeEngine::new();
        let store = Arc::new(MemoryCredentialStore::holding(credentials("old")));
        let token_file = std::env::temp_dir().join(format!(
            "woofx3-shoutout-registration-token-{}",
            std::process::id()
        ));
        std::fs::write(&token_file, "tok").expect("write the registration token");
        let registrar = Registrar::new(
            Arc::clone(&engine) as Arc<dyn EngineGateway>,
            Arc::clone(&store) as Arc<dyn CredentialStore>,
            token_file.clone(),
        );
        let (_engine_status, engine_status_rx) = watch::channel(EngineStatus {
            phase: EnginePhase::Ready,
            ..EngineStatus::starting()
        });
        let (session_tx, session) = watch::channel(LocalSession::Starting);
        let refusals = CredentialRefusals::new();
        let cancel = CancellationToken::new();
        let registration = tokio::spawn(run_registration(
            engine_status_rx,
            registrar,
            RegistrationOptions::default(),
            session_tx,
            refusals.clone(),
            cancel.clone(),
        ));
        let pacing = tokio::spawn(run_shoutout_pacing(
            Arc::clone(&queue),
            Arc::clone(&engine) as Arc<dyn EngineGateway>,
            session,
            refusals,
            cancel.clone(),
        ));
        let mut view = queue.subscribe();

        assert_eq!(calls.recv().await, Some(EngineCall::Verify("old".into())));
        engine.verified(Ok(()));
        queue.enqueue(channel("a")).expect("queued");
        assert_eq!(
            calls.recv().await,
            Some(EngineCall::SendShoutout("a".into()))
        );
        engine.reply(Err(HostError::CredentialsRefused {
            message: "AuthenticationRefused: client revoked".into(),
        }));

        // Registration checks the credentials again, and registers anew.
        assert_eq!(calls.recv().await, Some(EngineCall::Verify("old".into())));
        let paused = view.view();
        assert_eq!(
            paused.paused_reason.as_deref(),
            Some(PAUSED_FOR_CREDENTIALS)
        );
        assert_eq!(paused.entries[0].attempts, 0);
        assert_eq!(paused.entries[0].last_error, None);
        engine.verified(Err(HostError::CredentialsRefused {
            message: "AuthenticationRefused: client revoked".into(),
        }));
        assert_eq!(calls.recv().await, Some(EngineCall::RegisterClient));
        engine.registered(Ok(credentials("new")));

        // The queue resumes with the new credentials, after the cooldown.
        assert_eq!(sleeps.recv().await, Some(START + COOLDOWN));
        assert_eq!(queue.view().paused_reason, None);
        assert_eq!(store.stored(), Some(credentials("new")));
        clock.set(START + COOLDOWN);
        assert_eq!(
            calls.recv().await,
            Some(EngineCall::SendShoutout("a".into()))
        );
        assert_eq!(engine.senders(), ["old", "new"]);
        engine.reply(Ok(TwitchHelixResult::Ok));
        loop {
            if view.view().entries.is_empty() {
                break;
            }
            view.changed().await.expect("the queue lives");
        }

        cancel.cancel();
        for task in [registration, pacing] {
            tokio::time::timeout(Duration::from_secs(5), task)
                .await
                .expect("stops when cancelled")
                .expect("ends cleanly");
        }
        std::fs::remove_file(&token_file).expect("remove the registration token");
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_waits_for_the_engine_session() {
        let mut harness = Harness::start(LocalSession::Starting);
        harness.queue.enqueue(channel("a")).expect("queued");
        tokio::task::yield_now().await;
        assert!(harness.calls.try_recv().is_err(), "no session, no send");
        assert_eq!(harness.queue.entries()[0].attempts, 0);

        harness.session.send_replace(ready_session());
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        harness.attempted("a", |attempts| attempts.is_none()).await;
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_stops_mid_cooldown() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        harness.queue.enqueue(channel("b")).expect("queued");
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        harness.engine.reply(Ok(TwitchHelixResult::Ok));
        assert_eq!(harness.next_sleep().await, START + COOLDOWN);
        harness.stop().await;
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_stops_mid_send_and_keeps_the_entry() {
        let mut harness = Harness::start(ready_session());
        harness.queue.enqueue(channel("a")).expect("queued");
        assert_eq!(
            harness.next_call().await,
            EngineCall::SendShoutout("a".into())
        );
        let queue = Arc::clone(&harness.queue);
        harness.stop().await;
        let entries = queue.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].attempts, 0);
    }

    #[tokio::test]
    async fn test_run_shoutout_pacing_ends_with_the_registration() {
        let harness = Harness::start(LocalSession::Starting);
        let Harness {
            session, worker, ..
        } = harness;
        drop(session);
        tokio::time::timeout(Duration::from_secs(5), worker)
            .await
            .expect("the worker ends with the registration")
            .expect("the worker ends cleanly");
    }

    #[test]
    fn test_shoutout_entry_serializes_as_the_typescript_mirror_expects() {
        let (queue, _clock) = queue_at(START);
        queue
            .enqueue(ShoutoutChannel {
                twitch_user_id: "42".into(),
                login: "Wolfy".into(),
                display_name: "Wolfy".into(),
                profile_image_url: Some("https://img".into()),
                broadcaster_type: Some("partner".into()),
            })
            .expect("queued");
        assert_eq!(
            serde_json::to_value(queue.entries()).expect("serializes"),
            serde_json::json!([{
                "id": 0,
                "twitchUserId": "42",
                "login": "wolfy",
                "displayName": "Wolfy",
                "profileImageUrl": "https://img",
                "broadcasterType": "partner",
                "attempts": 0,
                "nextEligibleAt": START,
                "lastError": null,
            }])
        );
        assert_eq!(
            serde_json::to_value(ShoutoutEnqueued {
                id: ShoutoutEntryId(3),
                position: 2,
                already_queued: true
            })
            .expect("serializes"),
            serde_json::json!({ "id": 3, "position": 2, "alreadyQueued": true })
        );
    }

    #[test]
    fn test_shoutout_queue_view_serializes_as_the_typescript_mirror_expects() {
        let (queue, _clock) = queue_at(START);
        assert_eq!(
            serde_json::to_value(queue.view()).expect("serializes"),
            serde_json::json!({ "entries": [], "pausedReason": null })
        );
        queue.set_paused(Some(PAUSED_FOR_CREDENTIALS));
        assert_eq!(
            serde_json::to_value(queue.view()).expect("serializes"),
            serde_json::json!({ "entries": [], "pausedReason": PAUSED_FOR_CREDENTIALS })
        );
    }

    #[test]
    fn test_shoutout_channel_reads_the_typescript_shape() {
        let read: ShoutoutChannel = serde_json::from_value(serde_json::json!({
            "twitchUserId": "42",
            "login": "wolfy",
            "displayName": "Wolfy",
            "profileImageUrl": null,
            "broadcasterType": null,
        }))
        .expect("reads");
        assert_eq!(read.twitch_user_id, "42");
        assert_eq!(read.profile_image_url, None);
    }
}
