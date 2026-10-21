//! The local engine this host runs in local mode: the engine's orchestrator
//! as the host's one sidecar, supervised by `woofx3_companion_core::host`.
//! In companion mode there is none.
//!
//! Where the engine comes from: local mode runs the engine release named by
//! `engineDir` in the host configuration, else the release bundled with the
//! app under [`BUNDLED_ENGINE_DIR`] in its resource directory. The
//! orchestrator finds `services.json` and every service binary next to
//! itself, so it runs inside that release rather than as a lone binary
//! beside the app's own executable.

use std::path::Path;

use tauri::async_runtime::JoinHandle;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::host::{
    orchestrator_spec, run_sidecar, EnginePhase, EngineStatus, HostError, LocalEngineSettings,
    SidecarSpec,
};

/// The bundled engine release, relative to the app's resource directory.
pub const BUNDLED_ENGINE_DIR: &str = "engine";

/// Whether this host runs a local engine. Fixed at startup by the host mode.
pub enum LocalEngine {
    /// Companion mode: the engine runs elsewhere.
    Off,
    Supervised(EngineSidecar),
}

impl LocalEngine {
    /// Starts the engine local mode runs, from the release `settings` name
    /// or the one bundled in `resource_dir`.
    pub fn start(settings: &LocalEngineSettings, resource_dir: &Path) -> Result<Self, HostError> {
        let bundled = resource_dir.join(BUNDLED_ENGINE_DIR);
        let spec = orchestrator_spec(settings.engine_dir(&bundled))?;
        Ok(LocalEngine::Supervised(EngineSidecar::start(spec)))
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

/// The orchestrator under supervision.
pub struct EngineSidecar {
    status: watch::Receiver<EngineStatus>,
    cancel: CancellationToken,
    /// Taken by the first stop. Async, so a second stop waits for the first
    /// to finish instead of returning while the engine still runs.
    supervisor: tokio::sync::Mutex<Option<JoinHandle<()>>>,
}

impl EngineSidecar {
    fn start(spec: SidecarSpec) -> Self {
        let (status_tx, status) = watch::channel(EngineStatus::starting());
        let cancel = CancellationToken::new();
        let supervisor = tauri::async_runtime::spawn(run_sidecar(spec, status_tx, cancel.clone()));
        tauri::async_runtime::spawn(log_phases(status.clone()));
        EngineSidecar {
            status,
            cancel,
            supervisor: tokio::sync::Mutex::new(Some(supervisor)),
        }
    }

    fn phase(&self) -> EnginePhase {
        self.status.borrow().phase.clone()
    }

    async fn stop(&self) {
        self.cancel.cancel();
        let mut supervisor = self.supervisor.lock().await;
        if let Some(handle) = supervisor.take() {
            if let Err(err) = handle.await {
                eprintln!("[companion] the engine supervisor ended abnormally: {err}");
            }
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
