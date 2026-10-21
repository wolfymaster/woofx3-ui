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

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::host::{
    orchestrator_spec, run_registration, run_sidecar, EngineGateway, EnginePhase, EngineStatus,
    HostError, HttpEngineGateway, LocalEngineLayout, LocalEngineSettings, LocalSession,
    RegistrationOptions, SidecarSpec,
};

use crate::credentials::EngineClientStore;
use crate::lock;
use crate::state::LocalEngineSession;

/// The bundled engine release, relative to the app's resource directory.
pub const BUNDLED_ENGINE_DIR: &str = "engine";

/// Bounds each call to the local engine's gateway, connecting included.
const GATEWAY_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether this host runs a local engine. Fixed at startup by the host mode.
pub enum LocalEngine {
    /// Companion mode: the engine runs elsewhere.
    Off,
    Supervised(Box<EngineSidecar>),
}

impl LocalEngine {
    /// Starts the engine local mode runs, from the release `settings` name
    /// or the one bundled in `resource_dir`, keeping its state under
    /// `app_local_data_dir`.
    pub fn start(
        settings: &LocalEngineSettings,
        resource_dir: &Path,
        app_local_data_dir: &Path,
    ) -> Result<Self, HostError> {
        let bundled = resource_dir.join(BUNDLED_ENGINE_DIR);
        let layout = LocalEngineLayout::under(app_local_data_dir, settings.api_port());
        let spec = orchestrator_spec(settings.engine_dir(&bundled), &layout)?;
        let gateway = HttpEngineGateway::new(layout.api_url(), GATEWAY_TIMEOUT)?;
        Ok(LocalEngine::Supervised(Box::new(EngineSidecar::start(
            spec,
            layout,
            Arc::new(gateway),
        ))))
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

/// The orchestrator under supervision, and the registration that follows it.
pub struct EngineSidecar {
    spec: SidecarSpec,
    layout: LocalEngineLayout,
    gateway: Arc<HttpEngineGateway>,
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
    /// Stops both tasks.
    cancel: CancellationToken,
    supervisor: JoinHandle<()>,
    registration: JoinHandle<()>,
}

impl EngineSidecar {
    fn start(
        spec: SidecarSpec,
        layout: LocalEngineLayout,
        gateway: Arc<HttpEngineGateway>,
    ) -> Self {
        let (views, tasks) = launch(&spec, &layout, &gateway);
        EngineSidecar {
            spec,
            layout,
            gateway,
            views: std::sync::Mutex::new(views),
            tasks: tokio::sync::Mutex::new(Some(tasks)),
        }
    }

    fn phase(&self) -> EnginePhase {
        lock(&self.views).status.borrow().phase.clone()
    }

    fn session(&self) -> LocalEngineSession {
        let views = lock(&self.views);
        let session = views.session.borrow();
        match &*session {
            LocalSession::Starting => LocalEngineSession::Starting,
            LocalSession::Ready(credentials) => LocalEngineSession::Ready {
                api_url: self.layout.api_url(),
                client_id: credentials.client_id.clone(),
                client_secret: credentials.client_secret.clone(),
            },
            LocalSession::Failed { reason } => LocalEngineSession::Failed {
                reason: reason.clone(),
            },
        }
    }

    async fn stop(&self) {
        let mut tasks = self.tasks.lock().await;
        let Some(Tasks {
            cancel,
            supervisor,
            registration,
        }) = tasks.take()
        else {
            return;
        };
        cancel.cancel();
        if let Err(err) = registration.await {
            eprintln!("[companion] engine registration ended abnormally: {err}");
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
        let (views, started) = launch(&self.spec, &self.layout, &self.gateway);
        *lock(&self.views) = views;
        *tasks = Some(started);
    }
}

fn launch(
    spec: &SidecarSpec,
    layout: &LocalEngineLayout,
    gateway: &Arc<HttpEngineGateway>,
) -> (Views, Tasks) {
    let (status_tx, status) = watch::channel(EngineStatus::starting());
    let (session_tx, session) = watch::channel(LocalSession::Starting);
    let cancel = CancellationToken::new();
    let supervisor =
        tauri::async_runtime::spawn(run_sidecar(spec.clone(), status_tx, cancel.clone()));
    let registration = tauri::async_runtime::spawn(run_registration(
        status.clone(),
        Arc::clone(gateway) as Arc<dyn EngineGateway>,
        Arc::new(EngineClientStore),
        layout.registration_token_file.clone(),
        RegistrationOptions::default(),
        session_tx,
        cancel.clone(),
    ));
    tauri::async_runtime::spawn(log_status(status.clone()));
    tauri::async_runtime::spawn(log_sessions(session.clone()));
    (
        Views { status, session },
        Tasks {
            cancel,
            supervisor,
            registration,
        },
    )
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

    /// A sidecar whose program does not exist, so it only ever restarts.
    fn unstartable() -> LocalEngine {
        let app_data =
            std::env::temp_dir().join(format!("woofx3-no-orchestrator-{}", uuid::Uuid::new_v4()));
        let layout = LocalEngineLayout::under(&app_data, 1);
        let gateway =
            HttpEngineGateway::new(layout.api_url(), GATEWAY_TIMEOUT).expect("a gateway client");
        LocalEngine::Supervised(Box::new(EngineSidecar::start(
            SidecarSpec {
                program: app_data.join("orchestrator"),
                args: Vec::new(),
                current_dir: std::env::temp_dir(),
                env: Vec::new(),
            },
            layout,
            Arc::new(gateway),
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
}
