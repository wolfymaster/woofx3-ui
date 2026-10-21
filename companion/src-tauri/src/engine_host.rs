//! The local engine this host runs in local mode: the engine's orchestrator
//! as the host's one sidecar, supervised by `woofx3_companion_core::host`.
//! In companion mode there is none.
//!
//! Where the engine comes from: local mode runs the engine release named by
//! `engineDir` in the host configuration, else the release bundled with the
//! app under [`BUNDLED_ENGINE_DIR`] in its resource directory. The
//! orchestrator finds `services.json` and every service binary next to
//! itself, so it runs inside that release rather than as a lone binary
//! beside the app's own executable. Its state lives under the app's local
//! data directory ([`ENGINE_DATA_DIR`]), never in the release, which may be
//! read-only and is replaced by updates.

use std::path::Path;

use tauri::async_runtime::JoinHandle;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::host::{
    orchestrator_spec, run_sidecar, EnginePhase, EngineStatus, HostError, LocalEngineSettings,
    SidecarSpec,
};

use crate::lock;

/// The bundled engine release, relative to the app's resource directory.
pub const BUNDLED_ENGINE_DIR: &str = "engine";

/// The engine's data directory, relative to the app's local data directory.
pub const ENGINE_DATA_DIR: &str = "engine";

/// Whether this host runs a local engine. Fixed at startup by the host mode.
pub enum LocalEngine {
    /// Companion mode: the engine runs elsewhere.
    Off,
    Supervised(EngineSidecar),
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
        let spec = orchestrator_spec(
            settings.engine_dir(&bundled),
            &app_local_data_dir.join(ENGINE_DATA_DIR),
        )?;
        Ok(LocalEngine::Supervised(EngineSidecar::start(spec)))
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

/// The orchestrator under supervision.
pub struct EngineSidecar {
    spec: SidecarSpec,
    /// The status of the current run, swapped when the engine is resumed.
    status: std::sync::Mutex<watch::Receiver<EngineStatus>>,
    /// The supervisor while one runs. Async, so a second stop waits for the
    /// first to finish instead of returning while the engine still runs.
    supervisor: tokio::sync::Mutex<Option<Supervisor>>,
}

struct Supervisor {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

impl EngineSidecar {
    fn start(spec: SidecarSpec) -> Self {
        let (status, supervisor) = launch(&spec);
        EngineSidecar {
            spec,
            status: std::sync::Mutex::new(status),
            supervisor: tokio::sync::Mutex::new(Some(supervisor)),
        }
    }

    fn phase(&self) -> EnginePhase {
        lock(&self.status).borrow().phase.clone()
    }

    async fn stop(&self) {
        let mut supervisor = self.supervisor.lock().await;
        let Some(Supervisor { cancel, task }) = supervisor.take() else {
            return;
        };
        cancel.cancel();
        if let Err(err) = task.await {
            eprintln!("[companion] the engine supervisor ended abnormally: {err}");
        }
    }

    async fn resume(&self) {
        let mut supervisor = self.supervisor.lock().await;
        if supervisor.is_some() {
            return;
        }
        let (status, started) = launch(&self.spec);
        *lock(&self.status) = status;
        *supervisor = Some(started);
    }
}

fn launch(spec: &SidecarSpec) -> (watch::Receiver<EngineStatus>, Supervisor) {
    let (status_tx, status) = watch::channel(EngineStatus::starting());
    let cancel = CancellationToken::new();
    let task = tauri::async_runtime::spawn(run_sidecar(spec.clone(), status_tx, cancel.clone()));
    tauri::async_runtime::spawn(log_status(status.clone()));
    (status, Supervisor { cancel, task })
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A sidecar whose program does not exist, so it only ever restarts.
    fn unstartable() -> LocalEngine {
        let missing =
            std::env::temp_dir().join(format!("woofx3-no-orchestrator-{}", uuid::Uuid::new_v4()));
        LocalEngine::Supervised(EngineSidecar::start(SidecarSpec {
            program: missing.clone(),
            args: Vec::new(),
            current_dir: std::env::temp_dir(),
            env: Vec::new(),
        }))
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
    }
}
