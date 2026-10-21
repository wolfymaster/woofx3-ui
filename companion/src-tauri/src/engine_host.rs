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
//! beside the app's own executable.
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
    orchestrator_spec, run_registration, run_sidecar, EnginePhase, EngineStatus, HostError,
    HttpEngineGateway, LocalEngineLayout, LocalEngineSettings, LocalSession, RegistrationOptions,
    SidecarSpec,
};

use crate::credentials::EngineClientStore;
use crate::state::LocalEngineSession;

/// The bundled engine release, relative to the app's resource directory.
pub const BUNDLED_ENGINE_DIR: &str = "engine";

/// Bounds each call to the local engine's gateway, connecting included.
const GATEWAY_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether this host runs a local engine. Fixed at startup by the host mode.
pub enum LocalEngine {
    /// Companion mode: the engine runs elsewhere.
    Off,
    Supervised(EngineSidecar),
}

impl LocalEngine {
    /// Starts the engine local mode runs, from the release `settings` name
    /// or the one bundled in `resource_dir`, keeping its data under
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
        Ok(LocalEngine::Supervised(EngineSidecar::start(
            spec, layout, gateway,
        )))
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

    /// Whether quitting has to wait for the engine to stop first.
    pub fn must_stop_before_exit(&self) -> bool {
        match self {
            LocalEngine::Off => false,
            LocalEngine::Supervised(sidecar) => sidecar.phase() != EnginePhase::Stopped,
        }
    }
}

/// The orchestrator under supervision, and the registration that follows it.
pub struct EngineSidecar {
    api_url: String,
    status: watch::Receiver<EngineStatus>,
    session: watch::Receiver<LocalSession>,
    /// Stops both tasks.
    cancel: CancellationToken,
    /// Taken by the first stop. Async, so a second stop waits for the first
    /// to finish instead of returning while the engine still runs.
    tasks: tokio::sync::Mutex<Option<Tasks>>,
}

struct Tasks {
    supervisor: JoinHandle<()>,
    registration: JoinHandle<()>,
}

impl EngineSidecar {
    fn start(spec: SidecarSpec, layout: LocalEngineLayout, gateway: HttpEngineGateway) -> Self {
        let (status_tx, status) = watch::channel(EngineStatus::starting());
        let (session_tx, session) = watch::channel(LocalSession::Starting);
        let cancel = CancellationToken::new();
        let supervisor = tauri::async_runtime::spawn(run_sidecar(spec, status_tx, cancel.clone()));
        let registration = tauri::async_runtime::spawn(run_registration(
            status.clone(),
            Arc::new(gateway),
            Arc::new(EngineClientStore),
            layout.registration_token_file.clone(),
            RegistrationOptions::default(),
            session_tx,
            cancel.clone(),
        ));
        tauri::async_runtime::spawn(log_phases(status.clone()));
        tauri::async_runtime::spawn(log_sessions(session.clone()));
        EngineSidecar {
            api_url: layout.api_url(),
            status,
            session,
            cancel,
            tasks: tokio::sync::Mutex::new(Some(Tasks {
                supervisor,
                registration,
            })),
        }
    }

    fn phase(&self) -> EnginePhase {
        self.status.borrow().phase.clone()
    }

    fn session(&self) -> LocalEngineSession {
        match &*self.session.borrow() {
            LocalSession::Starting => LocalEngineSession::Starting,
            LocalSession::Ready(credentials) => LocalEngineSession::Ready {
                api_url: self.api_url.clone(),
                client_id: credentials.client_id.clone(),
                client_secret: credentials.client_secret.clone(),
            },
            LocalSession::Failed { reason } => LocalEngineSession::Failed {
                reason: reason.clone(),
            },
        }
    }

    async fn stop(&self) {
        self.cancel.cancel();
        let mut tasks = self.tasks.lock().await;
        let Some(Tasks {
            supervisor,
            registration,
        }) = tasks.take()
        else {
            return;
        };
        if let Err(err) = registration.await {
            eprintln!("[companion] engine registration ended abnormally: {err}");
        }
        if let Err(err) = supervisor.await {
            eprintln!("[companion] the engine supervisor ended abnormally: {err}");
        }
    }
}

/// Logs each change of phase. Ends with the supervisor, which drops the
/// sender when it returns.
async fn log_phases(mut status: watch::Receiver<EngineStatus>) {
    let mut last: Option<EnginePhase> = None;
    loop {
        let phase = status.borrow_and_update().phase.clone();
        if last.as_ref() != Some(&phase) {
            eprintln!("[companion] engine: {phase:?}");
            last = Some(phase);
        }
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
