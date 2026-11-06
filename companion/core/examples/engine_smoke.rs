//! Starts an engine release the way the desktop app starts its bundled
//! engine, with the same launch spec and supervisor and no other settings,
//! and fails unless it reports ready. It starts the engine twice on one data
//! directory: a first run, as on a fresh install, then a run over what the
//! first one wrote, as after a restart or an update.
//!
//! Usage: `cargo run --example engine_smoke -- <engine dir> [ready timeout in seconds]`

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::host::{
    orchestrator_spec, run_sidecar, EnginePhase, EngineStatus, LocalEngineLayout, StopCause,
    DEFAULT_API_PORT,
};

/// A cold Windows runner migrates the database and starts every service on
/// the first run; the app itself waits as long as it takes.
const DEFAULT_READY_TIMEOUT: Duration = Duration::from_secs(180);
const RUNS: [&str; 2] = ["first start", "start over existing data"];

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(engine_dir) = args.next().map(PathBuf::from) else {
        eprintln!("usage: engine_smoke <engine dir> [ready timeout in seconds]");
        return ExitCode::FAILURE;
    };
    let ready_timeout = match args.next().map(|value| value.parse::<u64>()) {
        None => DEFAULT_READY_TIMEOUT,
        Some(Ok(seconds)) if seconds > 0 => Duration::from_secs(seconds),
        Some(_) => {
            eprintln!("the ready timeout must be a whole number of seconds above 0");
            return ExitCode::FAILURE;
        }
    };
    let engine_dir = match std::fs::canonicalize(&engine_dir) {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("engine dir {}: {err}", engine_dir.display());
            return ExitCode::FAILURE;
        }
    };

    let app_data = std::env::temp_dir().join(format!("woofx3-engine-smoke-{}", std::process::id()));
    let layout = LocalEngineLayout::under(&app_data, DEFAULT_API_PORT);
    let mut outcome = ExitCode::SUCCESS;
    for run in RUNS {
        if let Err(reason) = start_until_ready(&engine_dir, &layout, ready_timeout).await {
            eprintln!("{run}: {reason}");
            outcome = ExitCode::FAILURE;
            break;
        }
        println!("{run}: ready");
    }
    if let Err(err) = std::fs::remove_dir_all(&app_data) {
        eprintln!("could not remove {}: {err}", app_data.display());
    }
    outcome
}

/// Runs the engine until it reports ready, then stops it and waits for it to
/// be gone, so the next run finds the data directory and ports free.
async fn start_until_ready(
    engine_dir: &std::path::Path,
    layout: &LocalEngineLayout,
    ready_timeout: Duration,
) -> Result<(), String> {
    let spec = orchestrator_spec(engine_dir, layout).map_err(|err| err.to_string())?;
    let (status_tx, mut status_rx) = watch::channel(EngineStatus::starting());
    let cancel = CancellationToken::new();
    let sidecar = tokio::spawn(run_sidecar(spec, status_tx, cancel.clone()));

    let waited = tokio::time::timeout(ready_timeout, async {
        loop {
            let status = status_rx.borrow_and_update().clone();
            match status.phase {
                EnginePhase::Ready => return Ok(()),
                // The app would restart it; a release must start the first time.
                EnginePhase::Restarting { reason, .. } => {
                    return Err(format!(
                        "the engine exited: {reason}; services: {:?}",
                        status.services
                    ));
                }
                EnginePhase::Stopped(cause) => {
                    return Err(format!("the engine stopped: {cause:?}"))
                }
                EnginePhase::Starting { .. }
                | EnginePhase::Migrating { .. }
                | EnginePhase::Stopping => {}
            }
            if status_rx.changed().await.is_err() {
                return Err("the supervisor ended without a status".to_string());
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        Err(format!(
            "not ready after {}s; services: {:?}",
            ready_timeout.as_secs(),
            status_rx.borrow().services
        ))
    });

    cancel.cancel();
    if let Err(err) = sidecar.await {
        return Err(format!("the supervisor task failed: {err}"));
    }
    let stopped = status_rx.borrow().phase.clone();
    if stopped != EnginePhase::Stopped(StopCause::Requested) {
        return Err(format!("the engine did not stop cleanly: {stopped:?}"));
    }
    waited
}
