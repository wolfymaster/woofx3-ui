//! The sidecar supervisor against a real child process: the fake
//! orchestrator in tests/support/fake_orchestrator.rs.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::backoff::Backoff;
use woofx3_companion_core::host::{
    run_sidecar_with, EnginePhase, EngineStatus, ServiceStatus, SidecarOptions, SidecarSpec,
};

const FAKE_ORCHESTRATOR: &str = env!("CARGO_BIN_EXE_fake-orchestrator");
/// Generous, so a slow CI machine does not fail a test that is not slow.
const WITHIN: Duration = Duration::from_secs(20);

/// A scratch directory per test, removed when the test ends.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("woofx3-sidecar-{name}-{}", std::process::id()));
        if dir.exists() {
            std::fs::remove_dir_all(&dir).expect("clear an old scratch directory");
        }
        std::fs::create_dir_all(&dir).expect("create the scratch directory");
        Scratch(dir)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    /// The values recorded under `key`, in order.
    fn recorded(&self, key: &str) -> Vec<String> {
        let raw = std::fs::read_to_string(self.path("record")).unwrap_or_default();
        raw.lines()
            .filter_map(|line| line.split_once('='))
            .filter(|(name, _)| *name == key)
            .map(|(_, value)| value.to_string())
            .collect()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn spec(scratch: &Scratch, script: &str) -> SidecarSpec {
    SidecarSpec {
        program: PathBuf::from(FAKE_ORCHESTRATOR),
        args: vec![OsString::from("--engine-arg")],
        current_dir: scratch.0.clone(),
        env: vec![
            ("FAKE_ORCHESTRATOR_SCRIPT".into(), script.into()),
            (
                "FAKE_ORCHESTRATOR_RECORD".into(),
                scratch.path("record").into(),
            ),
            ("FAKE_ORCHESTRATOR_RUNS".into(), scratch.path("runs").into()),
            ("FAKE_ENGINE_SETTING".into(), "on".into()),
        ],
    }
}

fn full_jitter() -> f64 {
    1.0
}

fn options() -> SidecarOptions {
    SidecarOptions {
        backoff: Backoff {
            initial: Duration::from_millis(200),
            max: Duration::from_millis(800),
        },
        stop_grace: Duration::from_secs(10),
        stable_after: Duration::from_secs(60),
        jitter: full_jitter,
    }
}

/// A running supervisor, every phase it went through, and its stop switch.
struct Running {
    status: watch::Receiver<EngineStatus>,
    phases: Arc<Mutex<Vec<EnginePhase>>>,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

fn start(spec: SidecarSpec, options: SidecarOptions) -> Running {
    let (status_tx, status) = watch::channel(EngineStatus::starting());
    let phases = Arc::new(Mutex::new(Vec::new()));
    let mut recorder = status.clone();
    let recorded = Arc::clone(&phases);
    tokio::spawn(async move {
        loop {
            let phase = recorder.borrow_and_update().phase.clone();
            {
                let mut phases = recorded.lock().expect("phases lock");
                if phases.last() != Some(&phase) {
                    phases.push(phase);
                }
            }
            if recorder.changed().await.is_err() {
                return;
            }
        }
    });
    let cancel = CancellationToken::new();
    let task = tokio::spawn(run_sidecar_with(spec, options, status_tx, cancel.clone()));
    Running {
        status,
        phases,
        cancel,
        task,
    }
}

impl Running {
    async fn wait_for(&mut self, what: &str, done: impl FnMut(&EngineStatus) -> bool) {
        let phases = Arc::clone(&self.phases);
        timeout(WITHIN, self.status.wait_for(done))
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {what}; phases: {phases:?}"))
            .unwrap_or_else(|_| panic!("the supervisor ended before {what}"));
    }

    fn phases(&self) -> Vec<EnginePhase> {
        self.phases.lock().expect("phases lock").clone()
    }

    fn restart_attempts(&self) -> Vec<u32> {
        self.phases()
            .into_iter()
            .filter_map(|phase| match phase {
                EnginePhase::Restarting { attempt, .. } => Some(attempt),
                _ => None,
            })
            .collect()
    }

    /// Stops the supervisor and waits for it, returning the final status.
    async fn stop(self) -> EngineStatus {
        self.cancel.cancel();
        timeout(WITHIN, self.task)
            .await
            .expect("the supervisor stops in time")
            .expect("the supervisor does not panic");
        let status = self.status.borrow().clone();
        status
    }
}

fn is_ready(status: &EngineStatus) -> bool {
    status.phase == EnginePhase::Ready
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    // Signal 0 checks for the process without sending anything.
    let pid = libc::pid_t::try_from(pid).expect("a pid fits");
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(unix)]
async fn wait_until_gone(pid: u32) {
    let gone = timeout(WITHIN, async {
        while process_exists(pid) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(gone.is_ok(), "process {pid} is still running");
}

fn only(values: Vec<String>, what: &str) -> String {
    assert_eq!(values.len(), 1, "expected one {what}, got {values:?}");
    values.into_iter().next().expect("one value")
}

#[tokio::test]
async fn test_sidecar_reports_ready_and_stops_when_stdin_closes() {
    let scratch = Scratch::new("ready");
    let mut running = start(spec(&scratch, "ready"), options());
    running.wait_for("ready", is_ready).await;

    let status = running.status.borrow().clone();
    assert_eq!(status.services.get("api"), Some(&ServiceStatus::Healthy));
    assert_eq!(
        status.services.get("sceneManager"),
        Some(&ServiceStatus::Healthy)
    );

    let started = std::time::Instant::now();
    let stopped = running.stop().await;
    // The fake stops on stdin closing, long before the grace period.
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(stopped.phase, EnginePhase::Stopped);
    assert_eq!(stopped.services.get("api"), Some(&ServiceStatus::Stopped));

    assert_eq!(
        scratch.recorded("arg"),
        vec![
            "--engine-arg".to_string(),
            "--exit-on-stdin-eof".to_string()
        ]
    );
    assert_eq!(
        scratch.recorded("env:WOOFX3_SUPERVISOR_STATUS"),
        vec!["stdout-jsonl".to_string()]
    );
    assert_eq!(
        scratch.recorded("env:FAKE_ENGINE_SETTING"),
        vec!["on".to_string()]
    );
    let cwd = PathBuf::from(only(scratch.recorded("cwd"), "working directory"));
    assert_eq!(
        cwd.canonicalize().expect("cwd exists"),
        scratch.0.canonicalize().expect("scratch exists")
    );
}

#[tokio::test]
async fn test_sidecar_restarts_with_growing_backoff_until_a_run_succeeds() {
    let scratch = Scratch::new("restarts");
    let mut running = start(spec(&scratch, "fail-runs:2"), options());
    running.wait_for("ready", is_ready).await;

    let phases = running.phases();
    let restarts: Vec<(u32, Duration, String)> = phases
        .iter()
        .filter_map(|phase| match phase {
            EnginePhase::Restarting {
                attempt,
                after,
                reason,
            } => Some((*attempt, *after, reason.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(restarts.len(), 2, "phases: {phases:?}");
    assert_eq!(restarts[0].0, 1);
    assert_eq!(restarts[0].1, Duration::from_millis(200));
    assert_eq!(restarts[1].0, 2);
    assert_eq!(restarts[1].1, Duration::from_millis(400));
    for (_, _, reason) in &restarts {
        assert!(
            reason.contains("services.json not found"),
            "the reason quotes the orchestrator's error: {reason}"
        );
    }
    assert!(phases.contains(&EnginePhase::Starting { attempt: 2 }));

    running.stop().await;
}

#[tokio::test]
async fn test_sidecar_backoff_stays_at_its_cap() {
    let scratch = Scratch::new("cap");
    let mut options = options();
    options.backoff = Backoff {
        initial: Duration::from_millis(100),
        max: Duration::from_millis(200),
    };
    let mut running = start(spec(&scratch, "fail"), options);
    running
        .wait_for("four restarts", |status| {
            matches!(status.phase, EnginePhase::Restarting { attempt, .. } if attempt >= 4)
        })
        .await;
    let delays: Vec<Duration> = running
        .phases()
        .into_iter()
        .filter_map(|phase| match phase {
            EnginePhase::Restarting { after, .. } => Some(after),
            _ => None,
        })
        .collect();
    assert_eq!(
        &delays[..4],
        &[
            Duration::from_millis(100),
            Duration::from_millis(200),
            Duration::from_millis(200),
            Duration::from_millis(200),
        ]
    );
    running.stop().await;
}

#[tokio::test]
async fn test_sidecar_backoff_starts_over_after_a_stable_run() {
    let scratch = Scratch::new("stable");
    let mut options = options();
    options.stable_after = Duration::from_millis(100);
    let running = start(spec(&scratch, "ready-then-exit:300"), options);
    timeout(WITHIN, async {
        while running.restart_attempts().len() < 3 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("three restarts");
    assert_eq!(&running.restart_attempts()[..3], &[1, 1, 1]);
    running.stop().await;
}

#[tokio::test]
async fn test_sidecar_backoff_grows_after_runs_shorter_than_stable() {
    let scratch = Scratch::new("unstable");
    let running = start(spec(&scratch, "ready-then-exit:50"), options());
    timeout(WITHIN, async {
        while running.restart_attempts().len() < 2 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("two restarts");
    assert_eq!(&running.restart_attempts()[..2], &[1, 2]);
    running.stop().await;
}

#[tokio::test]
async fn test_sidecar_kills_an_orchestrator_that_ignores_the_stop_request() {
    let scratch = Scratch::new("stubborn");
    let mut options = options();
    options.stop_grace = Duration::from_millis(300);
    let mut running = start(spec(&scratch, "stubborn"), options);
    running.wait_for("ready", is_ready).await;

    let stopped = running.stop().await;
    assert_eq!(stopped.phase, EnginePhase::Stopped);
    #[cfg(unix)]
    {
        let pid: u32 = only(scratch.recorded("pid"), "pid").parse().expect("a pid");
        wait_until_gone(pid).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn test_sidecar_stop_kills_the_services_the_orchestrator_started() {
    let scratch = Scratch::new("tree");
    let mut options = options();
    options.stop_grace = Duration::from_millis(300);
    let mut running = start(spec(&scratch, "stubborn-with-service"), options);
    running.wait_for("ready", is_ready).await;
    let service: u32 = only(scratch.recorded("service_pid"), "service pid")
        .parse()
        .expect("a pid");
    assert!(process_exists(service));

    running.stop().await;
    wait_until_gone(service).await;
}

#[cfg(unix)]
#[tokio::test]
async fn test_sidecar_kills_the_services_a_crashed_orchestrator_left_behind() {
    let scratch = Scratch::new("orphans");
    let mut running = start(spec(&scratch, "fail-leaving-service"), options());
    running
        .wait_for("a restart", |status| {
            matches!(status.phase, EnginePhase::Restarting { .. })
        })
        .await;
    let first_service: u32 = scratch.recorded("service_pid")[0].parse().expect("a pid");
    wait_until_gone(first_service).await;
    running.stop().await;
}

#[tokio::test]
async fn test_sidecar_retries_a_program_that_cannot_start() {
    let scratch = Scratch::new("missing");
    let mut spec = spec(&scratch, "ready");
    spec.program = scratch.path(if cfg!(windows) {
        "no-orchestrator.exe"
    } else {
        "no-orchestrator"
    });
    let mut running = start(spec, options());
    running
        .wait_for("a restart", |status| {
            matches!(status.phase, EnginePhase::Restarting { .. })
        })
        .await;
    let EnginePhase::Restarting { reason, .. } = running.status.borrow().phase.clone() else {
        unreachable!("waited for a restart");
    };
    assert!(reason.starts_with("could not start"), "{reason}");
    assert!(reason.contains("no-orchestrator"), "{reason}");
    let stopped = running.stop().await;
    assert_eq!(stopped.phase, EnginePhase::Stopped);
}

#[tokio::test]
async fn test_sidecar_stops_while_waiting_to_restart() {
    let scratch = Scratch::new("cancel-backoff");
    let mut options = options();
    options.backoff = Backoff {
        initial: Duration::from_secs(600),
        max: Duration::from_secs(600),
    };
    let mut running = start(spec(&scratch, "fail"), options);
    running
        .wait_for("a restart", |status| {
            matches!(status.phase, EnginePhase::Restarting { .. })
        })
        .await;
    let stopped = running.stop().await;
    assert_eq!(stopped.phase, EnginePhase::Stopped);
    assert!(Path::new(&scratch.path("runs")).exists());
}
