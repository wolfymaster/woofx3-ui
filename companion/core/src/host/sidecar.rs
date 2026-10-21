//! Runs the engine's orchestrator as the host's one sidecar, and keeps it
//! running until cancelled.
//!
//! The orchestrator is started with its status on stdout
//! (`WOOFX3_SUPERVISOR_STATUS=stdout-jsonl`) and `--exit-on-stdin-eof`, so the
//! host holds the write end of its stdin. Closing it is the stop request: the
//! orchestrator stops its services in dependency order and exits. That also
//! covers a host that dies without stopping it, since its stdin closes then
//! too.
//!
//! The process tree goes with it. On Windows the orchestrator puts itself and
//! its services in a job object that ends them all when it exits, and it is
//! started with `CREATE_NO_WINDOW`, which gives it the hidden console it needs
//! to stop its services gracefully. Elsewhere it is started in a process
//! group of its own, and the group is killed whenever the orchestrator exits,
//! so no service it left behind holds a port the next run needs.
//!
//! When the orchestrator exits on its own it is started again after a capped,
//! jittered exponential backoff. A run that stayed ready for
//! [`SidecarOptions::stable_after`] starts the backoff over.

use std::collections::{BTreeMap, VecDeque};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use rand::Rng;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Instant};
use tokio_util::sync::CancellationToken;

use super::status::{parse_status_line, ServiceStatus, StatusEvent, StatusLine};
use crate::backoff::Backoff;

/// Selects the orchestrator's status output. Must match `statusModeEnv` and
/// `statusModeStdoutJSONL` in the engine's build/orchestrator/supervision.go.
const STATUS_MODE_ENV: &str = "WOOFX3_SUPERVISOR_STATUS";
const STATUS_MODE_STDOUT_JSONL: &str = "stdout-jsonl";
const EXIT_ON_STDIN_EOF_FLAG: &str = "--exit-on-stdin-eof";

/// How many of the orchestrator's last stderr lines a restart reason quotes.
/// It writes to stderr only when it fails before its logger is up.
const STDERR_TAIL_LINES: usize = 5;

/// How long the output an exited orchestrator wrote is read for. Its pipes
/// stay open while anything it started still holds them, so the reads are
/// bounded rather than run to the end.
const OUTPUT_DRAIN: Duration = Duration::from_secs(1);

/// `CREATE_NO_WINDOW` from the Win32 process creation flags.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What to run. The supervision flag and variable are added by
/// [`run_sidecar`], so `args` and `env` hold only what the engine needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub current_dir: PathBuf,
    /// Set on top of the host's own environment.
    pub env: Vec<(OsString, OsString)>,
}

#[derive(Debug, Clone)]
pub struct SidecarOptions {
    /// The delay before each restart.
    pub backoff: Backoff,
    /// How long a stop request may take before the tree is killed. More than
    /// the orchestrator's own 25 seconds (`stopGracePeriod` in the engine's
    /// build/orchestrator/main.go), so its services get all of theirs.
    pub stop_grace: Duration,
    /// How long a run must stay ready for the backoff to start over.
    pub stable_after: Duration,
    /// The jitter for each restart delay, in `[0, 1]`.
    pub jitter: fn() -> f64,
}

impl Default for SidecarOptions {
    fn default() -> Self {
        SidecarOptions {
            backoff: Backoff {
                initial: Duration::from_secs(1),
                max: Duration::from_secs(60),
            },
            stop_grace: Duration::from_secs(35),
            stable_after: Duration::from_secs(60),
            jitter: random_jitter,
        }
    }
}

pub fn random_jitter() -> f64 {
    rand::rng().random_range(0.0..=1.0)
}

/// Where the engine stands, and the last status of each service the current
/// run reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineStatus {
    pub phase: EnginePhase,
    pub services: BTreeMap<String, ServiceStatus>,
}

impl EngineStatus {
    pub fn starting() -> Self {
        EngineStatus {
            phase: EnginePhase::Starting { attempt: 0 },
            services: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnginePhase {
    /// The orchestrator is starting its services. `attempt` counts the
    /// restarts since the last stable run.
    Starting { attempt: u32 },
    /// Every service passed its health check. The orchestrator says so once
    /// per run, so a service that fails later shows only in `services`.
    Ready,
    /// The orchestrator exited, or could not be started, and starts again
    /// after `after`.
    Restarting {
        attempt: u32,
        after: Duration,
        reason: String,
    },
    /// The host asked the orchestrator to stop.
    Stopping,
    /// The orchestrator and its services are gone, and stay gone.
    Stopped,
}

pub async fn run_sidecar(
    spec: SidecarSpec,
    status: watch::Sender<EngineStatus>,
    cancel: CancellationToken,
) {
    run_sidecar_with(spec, SidecarOptions::default(), status, cancel).await;
}

/// Runs the orchestrator until `cancel` fires, then stops it and returns.
/// The last status sent is always [`EnginePhase::Stopped`].
pub async fn run_sidecar_with(
    spec: SidecarSpec,
    options: SidecarOptions,
    status: watch::Sender<EngineStatus>,
    cancel: CancellationToken,
) {
    let mut attempt: u32 = 0;
    loop {
        status.send_modify(|current| {
            current.phase = EnginePhase::Starting { attempt };
            current.services.clear();
        });
        let ended = run_once(&spec, &options, &status, &cancel).await;
        let RunEnd::Exited { reason, ready_for } = ended else {
            break;
        };
        if ready_for.is_some_and(|ready_for| ready_for >= options.stable_after) {
            attempt = 0;
        }
        let jitter = (options.jitter)();
        let after = options.backoff.delay_with_jitter(attempt, jitter);
        attempt = attempt.saturating_add(1);
        status.send_modify(|current| {
            current.phase = EnginePhase::Restarting {
                attempt,
                after,
                reason,
            };
            // The run's services went with it.
            current.services.clear();
        });
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = sleep(after) => {}
        }
    }
    status.send_modify(|current| current.phase = EnginePhase::Stopped);
}

enum RunEnd {
    /// The host stopped the orchestrator.
    Stopped,
    /// The orchestrator exited, or never started. `ready_for` is how long it
    /// had been ready when it exited.
    Exited {
        reason: String,
        ready_for: Option<Duration>,
    },
}

/// One orchestrator process, from spawning it to its exit.
async fn run_once(
    spec: &SidecarSpec,
    options: &SidecarOptions,
    status: &watch::Sender<EngineStatus>,
    cancel: &CancellationToken,
) -> RunEnd {
    let mut process = match OrchestratorProcess::spawn(spec) {
        Ok(process) => process,
        Err(err) => {
            return RunEnd::Exited {
                reason: format!("could not start {}: {err}", spec.program.display()),
                ready_for: None,
            };
        }
    };
    let mut run = RunState::default();
    let exit = tokio::select! {
        _ = cancel.cancelled() => None,
        exit = process.follow(status, &mut run) => Some(exit),
    };
    let Some(exit) = exit else {
        process.stop(options.stop_grace, status, &mut run).await;
        return RunEnd::Stopped;
    };
    process.kill_tree();
    let stderr_tail = process.stderr_tail().await;
    RunEnd::Exited {
        reason: run.exit_reason(&exit, &stderr_tail),
        ready_for: run.ready_at.map(|ready_at| ready_at.elapsed()),
    }
}

/// What the current run's status lines said.
#[derive(Default)]
struct RunState {
    ready_at: Option<Instant>,
    /// The orchestrator's own last error, which explains its exit.
    fatal: Option<String>,
    /// Lines that did not parse, counted rather than kept: they are not the
    /// orchestrator's, and could be anything.
    unreadable_lines: usize,
}

impl RunState {
    fn apply(&mut self, line: &str, status: &watch::Sender<EngineStatus>) {
        let event = match parse_status_line(line) {
            Ok(StatusLine::Event(event)) => event,
            Ok(StatusLine::Unknown) => return,
            Err(_) => {
                self.unreadable_lines += 1;
                return;
            }
        };
        match event {
            StatusEvent::Service {
                name, status: next, ..
            } => {
                status.send_modify(|current| {
                    current.services.insert(name, next);
                });
            }
            StatusEvent::Ready => {
                self.ready_at = Some(Instant::now());
                status.send_modify(|current| {
                    if matches!(current.phase, EnginePhase::Starting { .. }) {
                        current.phase = EnginePhase::Ready;
                    }
                });
            }
            StatusEvent::Error {
                service: None,
                message,
            } => self.fatal = Some(message),
            StatusEvent::Error {
                service: Some(_), ..
            }
            | StatusEvent::Stopped => {}
        }
    }

    fn exit_reason(&self, exit: &std::io::Result<ExitStatus>, stderr_tail: &[String]) -> String {
        let mut reason = match exit {
            Ok(exit) => format!("the orchestrator exited ({exit})"),
            Err(err) => format!("the orchestrator could not be waited on ({err})"),
        };
        if let Some(fatal) = &self.fatal {
            reason.push_str(": ");
            reason.push_str(fatal);
        } else if !stderr_tail.is_empty() {
            reason.push_str(": ");
            reason.push_str(&stderr_tail.join(" / "));
        }
        if self.unreadable_lines > 0 {
            reason.push_str(&format!(
                " ({} unreadable status lines)",
                self.unreadable_lines
            ));
        }
        reason
    }
}

struct OrchestratorProcess {
    child: Child,
    /// The orchestrator's pid, which is also its process group. Kept past its
    /// exit, when the child no longer reports it, so the services it left
    /// behind can still be found.
    #[cfg(unix)]
    group: Option<u32>,
    /// Held open for as long as the orchestrator should run.
    stdin: Option<ChildStdin>,
    /// None once stdout has closed.
    lines: Option<Lines<BufReader<ChildStdout>>>,
    stderr_tail: Option<JoinHandle<VecDeque<String>>>,
}

impl OrchestratorProcess {
    fn spawn(spec: &SidecarSpec) -> std::io::Result<Self> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .arg(EXIT_ON_STDIN_EOF_FLAG)
            .current_dir(&spec.current_dir)
            .envs(spec.env.iter().map(|(key, value)| (key, value)))
            .env(STATUS_MODE_ENV, STATUS_MODE_STDOUT_JSONL)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A host task dropped without stopping the orchestrator still
            // takes it down.
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn()?;
        Ok(OrchestratorProcess {
            #[cfg(unix)]
            group: child.id(),
            stdin: child.stdin.take(),
            lines: child
                .stdout
                .take()
                .map(|stdout| BufReader::new(stdout).lines()),
            stderr_tail: child
                .stderr
                .take()
                .map(|stderr| tokio::spawn(keep_tail(stderr))),
            child,
        })
    }

    /// Applies status lines until the orchestrator exits, then the lines it
    /// wrote before exiting. Stdout is not waited on to close: a process the
    /// orchestrator started could hold it open.
    async fn follow(
        &mut self,
        status: &watch::Sender<EngineStatus>,
        run: &mut RunState,
    ) -> std::io::Result<ExitStatus> {
        let exit = loop {
            let reading = self.lines.is_some();
            tokio::select! {
                exit = self.child.wait() => break exit,
                line = next_line(&mut self.lines), if reading => {
                    if let Some(line) = line {
                        run.apply(&line, status);
                    }
                }
            }
        };
        let drained = timeout(OUTPUT_DRAIN, async {
            while let Some(line) = next_line(&mut self.lines).await {
                run.apply(&line, status);
            }
        })
        .await;
        if drained.is_err() {
            self.lines = None;
        }
        exit
    }

    /// Closes stdin and gives the orchestrator `grace` to stop its services
    /// and exit, following its status meanwhile. Whatever is left is killed.
    async fn stop(
        &mut self,
        grace: Duration,
        status: &watch::Sender<EngineStatus>,
        run: &mut RunState,
    ) {
        status.send_modify(|current| current.phase = EnginePhase::Stopping);
        drop(self.stdin.take());
        if timeout(grace, self.follow(status, run)).await.is_err() {
            self.kill_tree();
            // The kill is delivered, so this only reaps the process; an error
            // here leaves nothing more to do.
            let _reaped = self.child.wait().await;
        }
        self.kill_tree();
    }

    /// Kills the orchestrator and everything it started. Safe to call after
    /// it exited, when there is nothing left to kill.
    fn kill_tree(&mut self) {
        #[cfg(unix)]
        if let Some(group) = self.group {
            kill_process_group(group);
        }
        // On Windows this ends the orchestrator, and its job object ends the
        // services. It fails only for an orchestrator that already exited,
        // which is the outcome wanted.
        let _already_exited = self.child.start_kill();
    }

    /// The orchestrator's last lines on stderr. Waits a moment at most, for
    /// the same reason [`OrchestratorProcess::follow`] does not wait for
    /// stdout to close.
    async fn stderr_tail(&mut self) -> Vec<String> {
        let Some(task) = self.stderr_tail.take() else {
            return Vec::new();
        };
        match timeout(OUTPUT_DRAIN, task).await {
            Ok(Ok(tail)) => tail.into(),
            Ok(Err(_)) | Err(_) => Vec::new(),
        }
    }
}

/// The next status line, or None once stdout has closed. A read error counts
/// as closed: nothing more can be read either way.
async fn next_line(lines: &mut Option<Lines<BufReader<ChildStdout>>>) -> Option<String> {
    let reader = lines.as_mut()?;
    match reader.next_line().await {
        Ok(Some(line)) => Some(line),
        Ok(None) | Err(_) => {
            *lines = None;
            None
        }
    }
}

async fn keep_tail(stderr: impl AsyncRead + Unpin) -> VecDeque<String> {
    let mut tail = VecDeque::with_capacity(STDERR_TAIL_LINES);
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if tail.len() == STDERR_TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }
    tail
}

#[cfg(unix)]
fn kill_process_group(group: u32) {
    let Ok(group) = libc::pid_t::try_from(group) else {
        return;
    };
    // SAFETY: killpg only sends a signal; it touches no memory of ours. The
    // group is the one the orchestrator was started in, and an ESRCH (the
    // group is already empty) is the outcome wanted.
    unsafe {
        libc::killpg(group, libc::SIGKILL);
    }
}
