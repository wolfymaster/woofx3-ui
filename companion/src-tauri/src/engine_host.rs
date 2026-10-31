//! The local engine this host runs in local mode: the engine's orchestrator
//! as the host's one sidecar, supervised by `woofx3_companion_core::host`,
//! and this host registered as the engine's client. In companion mode there
//! is none.
//!
//! Where the engine comes from: local mode runs the engine release named by
//! `engineDir` in the host configuration, else the release bundled with the
//! app under [`BUNDLED_ENGINE_DIR`] in its resource directory. The
//! orchestrator finds `services.json` and every service binary next to
//! itself, so it runs inside that release rather than as a lone binary
//! beside the app's own executable. Its state lives under the app's local
//! data directory, never in the release, which may be read-only and is
//! replaced by updates.
//!
//! The client secret stays in this process and the credential store. The
//! window gets it only through `local_engine_session`, to open its own
//! capnweb session with the engine.
//!
//! In local mode this host also keeps the UI state that a cloud deployment's
//! dashboard backend keeps and the engine has no business holding: the
//! shoutout queue and the go-live checklist's stream start marker. Both live
//! in memory for as long as the app runs, outlast an engine restart, and
//! act through the engine with this host's own client credentials.

use std::path::Path;
use std::sync::Arc;

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::clock::{Clock, SystemClock};
use woofx3_companion_core::host::{
    orchestrator_spec, run_registration, run_shoutout_pacing, run_sidecar, run_stream_marker,
    ClientCredentials, CredentialRefusals, CredentialStore, EngineGateway, EnginePhase,
    EngineStatus, GatewayTimeouts, HostError, HttpEngineGateway, LocalEngineLayout,
    LocalEngineSettings, LocalSession, MarkerRequestOutcome, Registrar, RegistrationOptions,
    ShoutoutChannel, ShoutoutEnqueued, ShoutoutEntryId, ShoutoutOptions, ShoutoutQueue,
    ShoutoutQueueView, ShoutoutQueueWatch, SidecarSpec, StreamMarkerOptions, StreamMarkerRequests,
    StreamStartMarker,
};

use crate::lock;
use woofx3_companion_core::window::{
    LocalEngineSession, SHOUTOUT_QUEUE_EVENT, STREAM_START_MARKER_EVENT,
};

/// The answer to a local-mode call on a host that runs no local engine.
const NOT_LOCAL: &str = "This host runs no local engine.";

/// Where the window hears that local-mode UI state changed.
pub trait WindowEvents: Send + Sync + 'static {
    fn shoutout_queue_changed(&self, queue: &ShoutoutQueueView);
    fn stream_start_marker_changed(&self, marker: &StreamStartMarker);
}

impl WindowEvents for AppHandle {
    fn shoutout_queue_changed(&self, queue: &ShoutoutQueueView) {
        if let Err(err) = self.emit(SHOUTOUT_QUEUE_EVENT, queue) {
            eprintln!("[companion] could not send the shoutout queue to the window: {err}");
        }
    }

    fn stream_start_marker_changed(&self, marker: &StreamStartMarker) {
        if let Err(err) = self.emit(STREAM_START_MARKER_EVENT, marker) {
            eprintln!("[companion] could not send the stream start marker to the window: {err}");
        }
    }
}

/// The bundled engine release, relative to the app's resource directory.
pub const BUNDLED_ENGINE_DIR: &str = "engine";

/// Whether this host runs a local engine. Fixed at startup by the host mode.
pub enum LocalEngine {
    /// Companion mode: the engine runs elsewhere.
    Off,
    Supervised(Box<EngineSidecar>),
}

impl LocalEngine {
    /// Starts the engine local mode runs, from the release `settings` name
    /// or the one bundled in `resource_dir`, keeping its state under
    /// `app_local_data_dir` and the client credentials it issues in
    /// `client_store`.
    pub fn start(
        settings: &LocalEngineSettings,
        resource_dir: &Path,
        app_local_data_dir: &Path,
        client_store: Arc<dyn CredentialStore>,
        events: Arc<dyn WindowEvents>,
    ) -> Result<Self, HostError> {
        let bundled = resource_dir.join(BUNDLED_ENGINE_DIR);
        let layout = LocalEngineLayout::under(app_local_data_dir, settings.api_port());
        let spec = orchestrator_spec(settings.engine_dir(&bundled), &layout)?;
        let options = RegistrationOptions::default();
        let gateway = HttpEngineGateway::new(layout.api_url(), GatewayTimeouts::default())?;
        Ok(LocalEngine::Supervised(Box::new(EngineSidecar::start(
            spec,
            layout,
            Arc::new(gateway),
            client_store,
            options,
            Arc::new(SystemClock),
            events,
        ))))
    }

    fn sidecar(&self) -> Result<&EngineSidecar, String> {
        match self {
            LocalEngine::Off => Err(NOT_LOCAL.to_string()),
            LocalEngine::Supervised(sidecar) => Ok(sidecar),
        }
    }

    /// The shoutout queue, in order, and why it is paused, if it is.
    pub fn shoutout_queue(&self) -> Result<ShoutoutQueueView, String> {
        Ok(self.sidecar()?.launcher.shoutouts.view())
    }

    pub fn enqueue_shoutout(&self, channel: ShoutoutChannel) -> Result<ShoutoutEnqueued, String> {
        self.sidecar()?
            .launcher
            .shoutouts
            .enqueue(channel)
            .map_err(|err| err.to_string())
    }

    pub fn remove_shoutout(&self, id: ShoutoutEntryId) -> Result<(), String> {
        self.sidecar()?
            .launcher
            .shoutouts
            .remove(id)
            .map_err(|err| err.to_string())
    }

    pub fn reorder_shoutouts(&self, ids: &[ShoutoutEntryId]) -> Result<(), String> {
        self.sidecar()?.launcher.shoutouts.reorder(ids);
        Ok(())
    }

    pub fn stream_start_marker(&self) -> Result<StreamStartMarker, String> {
        Ok(self.sidecar()?.launcher.markers.current())
    }

    /// Drops the stream start marker now when the stream is live, else when
    /// it next goes live.
    pub async fn request_stream_start_marker(&self) -> Result<MarkerRequestOutcome, String> {
        let sidecar = self.sidecar()?;
        let Some(credentials) = sidecar.credentials() else {
            return Ok(MarkerRequestOutcome::Failed {
                message: "The local engine is not ready yet.".to_string(),
            });
        };
        let launcher = &sidecar.launcher;
        Ok(launcher
            .markers
            .request(launcher.gateway.as_ref(), &credentials)
            .await)
    }

    /// What the window needs to open a session with the engine.
    pub fn session(&self) -> LocalEngineSession {
        match self {
            LocalEngine::Off => LocalEngineSession::NotLocal,
            LocalEngine::Supervised(sidecar) => sidecar.session(),
        }
    }

    /// Stops the engine, if there is one, and waits until it is gone.
    pub async fn stop(&self) {
        if let LocalEngine::Supervised(sidecar) = self {
            sidecar.stop().await;
        }
    }

    /// Starts the engine again after [`LocalEngine::stop`], as when an
    /// update that stopped it could not be installed. Does nothing while it
    /// runs.
    pub async fn resume(&self) {
        if let LocalEngine::Supervised(sidecar) = self {
            sidecar.resume().await;
        }
    }

    /// Whether quitting has to wait for the engine to stop first.
    pub fn must_stop_before_exit(&self) -> bool {
        match self {
            LocalEngine::Off => false,
            LocalEngine::Supervised(sidecar) => !matches!(sidecar.phase(), EnginePhase::Stopped(_)),
        }
    }
}

/// The orchestrator under supervision, the registration that follows it,
/// and the workers that act through the engine for the window.
pub struct EngineSidecar {
    launcher: Launcher,
    /// What the current run reports, swapped when the engine is resumed.
    views: std::sync::Mutex<Views>,
    /// The tasks while they run. Async, so a second stop waits for the first
    /// to finish instead of returning while the engine still runs.
    tasks: tokio::sync::Mutex<Option<Tasks>>,
}

struct Views {
    status: watch::Receiver<EngineStatus>,
    session: watch::Receiver<LocalSession>,
}

struct Tasks {
    /// Stops every task.
    cancel: CancellationToken,
    supervisor: JoinHandle<()>,
    /// Registration and the tasks that follow the session or the window's
    /// state, stopped before the supervisor so none acts on a dying engine.
    followers: Vec<(&'static str, JoinHandle<()>)>,
}

impl EngineSidecar {
    fn start(
        spec: SidecarSpec,
        layout: LocalEngineLayout,
        gateway: Arc<HttpEngineGateway>,
        client_store: Arc<dyn CredentialStore>,
        options: RegistrationOptions,
        clock: Arc<dyn Clock>,
        events: Arc<dyn WindowEvents>,
    ) -> Self {
        let shoutouts = Arc::new(ShoutoutQueue::new(
            Arc::clone(&clock),
            ShoutoutOptions::default(),
        ));
        let markers = Arc::new(StreamMarkerRequests::new(
            clock,
            StreamMarkerOptions::default(),
        ));
        let launcher = Launcher {
            spec,
            layout,
            gateway,
            client_store,
            options,
            shoutouts,
            markers,
            events,
        };
        let (views, tasks) = launcher.launch();
        EngineSidecar {
            launcher,
            views: std::sync::Mutex::new(views),
            tasks: tokio::sync::Mutex::new(Some(tasks)),
        }
    }

    fn phase(&self) -> EnginePhase {
        lock(&self.views).status.borrow().phase.clone()
    }

    /// This host's engine credentials, once it is registered.
    fn credentials(&self) -> Option<ClientCredentials> {
        match &*lock(&self.views).session.borrow() {
            LocalSession::Ready(credentials) => Some(credentials.clone()),
            LocalSession::Starting | LocalSession::Failed { .. } => None,
        }
    }

    fn session(&self) -> LocalEngineSession {
        let views = lock(&self.views);
        let engine = views.status.borrow();
        let session = views.session.borrow();
        LocalEngineSession::from_engine(&engine.phase, &session, || self.launcher.layout.api_url())
    }

    async fn stop(&self) {
        let mut tasks = self.tasks.lock().await;
        let Some(Tasks {
            cancel,
            supervisor,
            followers,
        }) = tasks.take()
        else {
            return;
        };
        cancel.cancel();
        for (name, follower) in followers {
            if let Err(err) = follower.await {
                eprintln!("[companion] the {name} ended abnormally: {err}");
            }
        }
        if let Err(err) = supervisor.await {
            eprintln!("[companion] the engine supervisor ended abnormally: {err}");
        }
    }

    async fn resume(&self) {
        let mut tasks = self.tasks.lock().await;
        if tasks.is_some() {
            return;
        }
        let (views, started) = self.launcher.launch();
        *lock(&self.views) = views;
        *tasks = Some(started);
    }
}

/// What every run of the engine is started from.
struct Launcher {
    spec: SidecarSpec,
    layout: LocalEngineLayout,
    gateway: Arc<HttpEngineGateway>,
    client_store: Arc<dyn CredentialStore>,
    options: RegistrationOptions,
    /// Kept across engine restarts; only the workers stop with the engine.
    shoutouts: Arc<ShoutoutQueue>,
    markers: Arc<StreamMarkerRequests>,
    events: Arc<dyn WindowEvents>,
}

impl Launcher {
    fn launch(&self) -> (Views, Tasks) {
        let (status_tx, status) = watch::channel(EngineStatus::starting());
        let (session_tx, session) = watch::channel(LocalSession::Starting);
        // Lets the workers tell registration the engine refused the
        // credentials they act with.
        let refusals = CredentialRefusals::new();
        let cancel = CancellationToken::new();
        let supervisor =
            tauri::async_runtime::spawn(run_sidecar(self.spec.clone(), status_tx, cancel.clone()));
        let gateway = Arc::clone(&self.gateway) as Arc<dyn EngineGateway>;
        let registrar = Registrar::new(
            Arc::clone(&gateway),
            Arc::clone(&self.client_store),
            self.layout.registration_token_file.clone(),
        );
        let registration = tauri::async_runtime::spawn(run_registration(
            status.clone(),
            registrar,
            self.options.clone(),
            session_tx,
            refusals.clone(),
            cancel.clone(),
        ));
        let shoutout_pacing = tauri::async_runtime::spawn(run_shoutout_pacing(
            Arc::clone(&self.shoutouts),
            Arc::clone(&gateway),
            session.clone(),
            status.clone(),
            refusals.clone(),
            cancel.clone(),
        ));
        let stream_marker = tauri::async_runtime::spawn(run_stream_marker(
            Arc::clone(&self.markers),
            gateway,
            session.clone(),
            refusals,
            cancel.clone(),
        ));
        let shoutout_events = tauri::async_runtime::spawn(forward_shoutout_queue(
            self.shoutouts.subscribe(),
            Arc::clone(&self.events),
            cancel.clone(),
        ));
        let marker_events = tauri::async_runtime::spawn(forward_stream_start_marker(
            self.markers.subscribe(),
            Arc::clone(&self.events),
            cancel.clone(),
        ));
        tauri::async_runtime::spawn(log_status(status.clone()));
        tauri::async_runtime::spawn(log_sessions(session.clone()));
        (
            Views { status, session },
            Tasks {
                cancel,
                supervisor,
                followers: vec![
                    ("engine registration", registration),
                    ("shoutout queue", shoutout_pacing),
                    ("stream start marker", stream_marker),
                    ("shoutout queue events", shoutout_events),
                    ("stream start marker events", marker_events),
                ],
            },
        )
    }
}

/// Sends the queue to the window now and after every change, until
/// cancelled. Sending it first means a change made while the engine was
/// stopped still reaches the window when it starts again.
async fn forward_shoutout_queue(
    mut queue: ShoutoutQueueWatch,
    events: Arc<dyn WindowEvents>,
    cancel: CancellationToken,
) {
    loop {
        events.shoutout_queue_changed(&queue.view());
        tokio::select! {
            _ = cancel.cancelled() => return,
            changed = queue.changed() => if changed.is_err() { return; },
        }
    }
}

/// Sends the marker's state to the window now and after every change, and
/// logs a marker that could not be dropped, until cancelled.
async fn forward_stream_start_marker(
    mut marker: watch::Receiver<StreamStartMarker>,
    events: Arc<dyn WindowEvents>,
    cancel: CancellationToken,
) {
    loop {
        let current = marker.borrow_and_update().clone();
        if let StreamStartMarker::Failed { message } = &current {
            eprintln!("[companion] could not drop the stream start marker: {message}");
        }
        events.stream_start_marker_changed(&current);
        tokio::select! {
            _ = cancel.cancelled() => return,
            changed = marker.changed() => if changed.is_err() { return; },
        }
    }
}

/// Logs each change of phase, and each failure to kill the process tree.
/// Ends with the supervisor, which drops the sender when it returns.
async fn log_status(mut status: watch::Receiver<EngineStatus>) {
    let mut last_phase: Option<EnginePhase> = None;
    let mut last_kill_failure: Option<String> = None;
    loop {
        let (phase, kill_failure) = {
            let current = status.borrow_and_update();
            (current.phase.clone(), current.kill_failure.clone())
        };
        if last_phase.as_ref() != Some(&phase) {
            eprintln!("[companion] engine: {phase:?}");
            last_phase = Some(phase);
        }
        if kill_failure.is_some() && kill_failure != last_kill_failure {
            eprintln!(
                "[companion] engine services may still be running: {}",
                kill_failure.as_deref().unwrap_or_default()
            );
        }
        last_kill_failure = kill_failure;
        if status.changed().await.is_err() {
            return;
        }
    }
}

/// Logs each change of registration, never the credentials. Ends with the
/// registration task.
async fn log_sessions(mut session: watch::Receiver<LocalSession>) {
    loop {
        match &*session.borrow_and_update() {
            LocalSession::Starting => eprintln!("[companion] engine session: starting"),
            LocalSession::Ready(credentials) => eprintln!(
                "[companion] engine session: registered as {}",
                credentials.client_id
            ),
            LocalSession::Failed { reason } => {
                eprintln!("[companion] engine session: registration failed: {reason}")
            }
        }
        if session.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drops every event.
    struct NoWindow;

    impl WindowEvents for NoWindow {
        fn shoutout_queue_changed(&self, _queue: &ShoutoutQueueView) {}
        fn stream_start_marker_changed(&self, _marker: &StreamStartMarker) {}
    }

    fn channel(id: &str) -> ShoutoutChannel {
        ShoutoutChannel {
            twitch_user_id: id.to_string(),
            login: id.to_string(),
            display_name: id.to_string(),
            profile_image_url: None,
            broadcaster_type: None,
        }
    }

    /// Never read or written: an engine that never starts never registers.
    fn unused_client_store() -> crate::credentials::EngineClientStore {
        let identity = woofx3_companion_core::AppIdentity::new("tv.woofx3.test", "woofx3 test")
            .expect("a valid identity");
        crate::credentials::Credentials::new(&identity).engine_client_store()
    }

    /// A sidecar whose program does not exist, so it only ever restarts.
    fn unstartable() -> LocalEngine {
        let app_data =
            std::env::temp_dir().join(format!("woofx3-no-orchestrator-{}", uuid::Uuid::new_v4()));
        let layout = LocalEngineLayout::under(&app_data, 1);
        let options = RegistrationOptions::default();
        let gateway = HttpEngineGateway::new(layout.api_url(), GatewayTimeouts::default())
            .expect("a gateway client");
        LocalEngine::Supervised(Box::new(EngineSidecar::start(
            SidecarSpec {
                program: app_data.join("orchestrator"),
                args: Vec::new(),
                current_dir: std::env::temp_dir(),
                env: Vec::new(),
            },
            layout,
            Arc::new(gateway),
            Arc::new(unused_client_store()),
            options,
            Arc::new(SystemClock),
            Arc::new(NoWindow),
        )))
    }

    #[tokio::test]
    async fn test_local_engine_stops_and_resumes() {
        let engine = unstartable();
        assert!(engine.must_stop_before_exit());

        engine.stop().await;
        assert!(!engine.must_stop_before_exit());
        engine.stop().await;

        engine.resume().await;
        assert!(engine.must_stop_before_exit());
        engine.stop().await;
        assert!(!engine.must_stop_before_exit());
    }

    #[tokio::test]
    async fn test_local_engine_off_has_nothing_to_stop() {
        let engine = LocalEngine::Off;
        engine.stop().await;
        engine.resume().await;
        assert!(!engine.must_stop_before_exit());
        assert_eq!(engine.session(), LocalEngineSession::NotLocal);
    }

    #[tokio::test]
    async fn test_local_engine_off_refuses_local_mode_calls() {
        let engine = LocalEngine::Off;
        assert_eq!(engine.shoutout_queue(), Err(NOT_LOCAL.to_string()));
        assert_eq!(
            engine.enqueue_shoutout(channel("a")),
            Err(NOT_LOCAL.to_string())
        );
        assert_eq!(
            engine.remove_shoutout(ShoutoutEntryId(0)),
            Err(NOT_LOCAL.to_string())
        );
        assert_eq!(engine.reorder_shoutouts(&[]), Err(NOT_LOCAL.to_string()));
        assert_eq!(engine.stream_start_marker(), Err(NOT_LOCAL.to_string()));
        assert_eq!(
            engine.request_stream_start_marker().await,
            Err(NOT_LOCAL.to_string())
        );
    }

    #[tokio::test]
    async fn test_local_engine_keeps_the_shoutout_queue_across_a_restart() {
        let engine = unstartable();
        engine.enqueue_shoutout(channel("a")).expect("queued");
        engine.stop().await;
        engine
            .enqueue_shoutout(channel("b"))
            .expect("queued while stopped");
        engine.resume().await;
        let logins: Vec<String> = engine
            .shoutout_queue()
            .expect("local")
            .entries
            .into_iter()
            .map(|entry| entry.login)
            .collect();
        assert_eq!(logins, ["a", "b"]);
        engine.stop().await;
    }

    #[tokio::test]
    async fn test_local_engine_marker_request_waits_for_a_session() {
        let engine = unstartable();
        assert_eq!(
            engine.request_stream_start_marker().await,
            Ok(MarkerRequestOutcome::Failed {
                message: "The local engine is not ready yet.".to_string()
            })
        );
        assert_eq!(engine.stream_start_marker(), Ok(StreamStartMarker::Idle));
        engine.stop().await;
    }
}
