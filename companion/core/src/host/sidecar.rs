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
//! so no service it left behind holds a port the next run needs. The exit is
//! noticed without reaping the orchestrator (`waitid` with `WNOWAIT`), so its
//! zombie keeps the group id reserved until the group has been killed: the
//! kill can never reach a group that later took the same id. Dropping the
//! process kills the tree too, so a supervisor task that is aborted rather
//! than cancelled leaves nothing behind.
//!
//! When the orchestrator fails it is started again after a capped, jittered
//! exponential backoff. A run that stayed ready for
//! [`SidecarOptions::stable_after`] starts the backoff over. When it exits
//! cleanly without being asked to (no enabled services, or a stop request
//! from outside the host), the sidecar stops for good and says why.

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
    /// The last time killing the orchestrator's process tree failed for a
    /// reason other than there being nothing left to kill. Services may then
    /// still be running.
    pub kill_failure: Option<String>,
}

impl EngineStatus {
    pub fn starting() -> Self {
        EngineStatus {
            phase: EnginePhase::Starting { attempt: 0 },
            services: BTreeMap::new(),
            kill_failure: None,
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
    Stopped(StopCause),
}

/// Why the sidecar stopped for good.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopCause {
    /// The host cancelled it.
    Requested,
    /// The orchestrator exited cleanly without the host asking. Starting it
    /// again would only repeat that.
    ExitedOnItsOwn { reason: String },
}

pub async fn run_sidecar(
    spec: SidecarSpec,
    status: watch::Sender<EngineStatus>,
    cancel: CancellationToken,
) {
    run_sidecar_with(spec, SidecarOptions::default(), status, cancel).await;
}

/// Runs the orchestrator until `cancel` fires, then stops it and returns, or
/// until it exits cleanly on its own. The last status sent is always
/// [`EnginePhase::Stopped`].
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
        let (reason, ready_for) = match run_once(&spec, &options, &status, &cancel).await {
            RunEnd::Stopped => break,
            RunEnd::ExitedCleanly { reason } => {
                status.send_modify(|current| {
                    current.phase = EnginePhase::Stopped(StopCause::ExitedOnItsOwn { reason });
                    current.services.clear();
                });
                return;
            }
            RunEnd::Failed { reason, ready_for } => (reason, ready_for),
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
    status.send_modify(|current| current.phase = EnginePhase::Stopped(StopCause::Requested));
}

enum RunEnd {
    /// The host stopped the orchestrator.
    Stopped,
    /// The orchestrator exited with success without being asked to.
    ExitedCleanly { reason: String },
    /// The orchestrator failed, or never started. `ready_for` is how long it
    /// had been ready when it exited.
    Failed {
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
            return RunEnd::Failed {
                reason: format!("could not start {}: {err}", spec.program.display()),
                ready_for: None,
            };
        }
    };
    let mut run = RunState::default();
    let exited = tokio::select! {
        _ = cancel.cancelled() => None,
        exited = process.follow(status, &mut run) => Some(exited),
    };
    let Some(exited) = exited else {
        process.stop(options.stop_grace, status, &mut run).await;
        return RunEnd::Stopped;
    };
    let exit = process.finish(exited, status).await;
    let stderr_tail = process.stderr_tail().await;
    let reason = run.exit_reason(&exit, &stderr_tail);
    if exit.as_ref().is_ok_and(ExitStatus::success) {
        return RunEnd::ExitedCleanly { reason };
    }
    RunEnd::Failed {
        reason,
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
    /// Where the orchestrator is in leaving. Its process group is only ever
    /// signalled before it is reaped.
    exit: ExitWatch,
    /// Held open for as long as the orchestrator should run.
    stdin: Option<ChildStdin>,
    /// None once stdout has closed.
    lines: Option<Lines<BufReader<ChildStdout>>>,
    stderr_tail: Option<JoinHandle<VecDeque<String>>>,
}

enum ExitWatch {
    Running,
    /// A blocking thread is waiting for the exit without reaping it.
    #[cfg(unix)]
    Watching(JoinHandle<std::io::Result<()>>),
    /// It has exited and is not reaped yet, so on Unix its zombie still holds
    /// its pid and so its process group id.
    Exited,
    /// Reaped: its group id may now belong to someone else.
    Reaped,
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
            .stderr(Stdio::piped());
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command.spawn()?;
        Ok(OrchestratorProcess {
            exit: ExitWatch::Running,
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

    async fn exited(&mut self) -> std::io::Result<()> {
        watch_exit(&mut self.child, &mut self.exit).await
    }

    /// Applies status lines until the orchestrator exits, then the lines it
    /// wrote before exiting. Stdout is not waited on to close: a process the
    /// orchestrator started could hold it open.
    async fn follow(
        &mut self,
        status: &watch::Sender<EngineStatus>,
        run: &mut RunState,
    ) -> std::io::Result<()> {
        let exited = loop {
            let reading = self.lines.is_some();
            tokio::select! {
                exited = watch_exit(&mut self.child, &mut self.exit) => break exited,
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
        exited
    }

    /// After the orchestrator exited: kills whatever it left behind, then
    /// reaps it. If its exit could not be watched, the group cannot be told
    /// apart from a later one with the same id, so only the orchestrator
    /// itself is killed.
    async fn finish(
        &mut self,
        exited: std::io::Result<()>,
        status: &watch::Sender<EngineStatus>,
    ) -> std::io::Result<ExitStatus> {
        let killed = match exited {
            Ok(()) => self.kill_tree(),
            Err(err) => {
                let killed = self.kill_orchestrator();
                Err(std::io::Error::other(format!(
                    "could not watch the orchestrator's exit, so its services were not killed: {err}{}",
                    killed.err().map(|err| format!("; {err}")).unwrap_or_default()
                )))
            }
        };
        if let Err(err) = killed {
            status.send_modify(|current| current.kill_failure = Some(err.to_string()));
        }
        let reaped = self.child.wait().await;
        self.exit = ExitWatch::Reaped;
        reaped
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
        let exited = match timeout(grace, self.follow(status, run)).await {
            Ok(exited) => exited,
            Err(_) => {
                if let Err(err) = self.kill_tree() {
                    status.send_modify(|current| current.kill_failure = Some(err.to_string()));
                }
                self.exited().await
            }
        };
        // Only the reap's outcome is left to learn, and nothing more can be
        // done whichever it is.
        let _reaped = self.finish(exited, status).await;
    }

    /// Kills the orchestrator and everything it started. Only called before
    /// the orchestrator is reaped, so on Unix its group id is still its own.
    fn kill_tree(&mut self) -> std::io::Result<()> {
        debug_assert!(
            !matches!(self.exit, ExitWatch::Reaped),
            "the process group of a reaped orchestrator is not ours to signal"
        );
        #[cfg(unix)]
        if let Some(group) = self.group() {
            kill_process_group(group)?;
        }
        // On Windows this ends the orchestrator, and its job object ends the
        // services.
        self.kill_orchestrator()
    }

    /// Kills the orchestrator alone. One that already exited cannot be
    /// killed, which is the outcome wanted.
    fn kill_orchestrator(&mut self) -> std::io::Result<()> {
        match self.child.start_kill() {
            Err(err) if err.kind() != std::io::ErrorKind::InvalidInput => Err(err),
            _ => Ok(()),
        }
    }

    /// The orchestrator's process group, which is its pid, while it is not
    /// reaped. tokio forgets the pid only once `wait` has seen the exit,
    /// which happens only in the reap.
    #[cfg(unix)]
    fn group(&self) -> Option<u32> {
        if matches!(self.exit, ExitWatch::Reaped) {
            return None;
        }
        self.child.id()
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

/// A supervisor task that is dropped, not cancelled, still takes the tree
/// down. Errors cannot be reported from here, and nothing else would see them.
impl Drop for OrchestratorProcess {
    fn drop(&mut self) {
        if !matches!(self.exit, ExitWatch::Reaped) {
            let _best_effort = self.kill_tree();
        }
    }
}

/// Resolves once the orchestrator has exited, leaving it unreaped on Unix.
/// Cancel-safe: the wait carries on where it left off.
async fn watch_exit(child: &mut Child, exit: &mut ExitWatch) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        if matches!(exit, ExitWatch::Running) {
            let Some(pid) = child.id() else {
                *exit = ExitWatch::Exited;
                return Ok(());
            };
            *exit = ExitWatch::Watching(tokio::task::spawn_blocking(move || wait_unreaped(pid)));
        }
        if let ExitWatch::Watching(waiter) = exit {
            let watched = waiter.await;
            *exit = ExitWatch::Exited;
            return watched.unwrap_or_else(|join| Err(std::io::Error::other(join)));
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        if matches!(exit, ExitWatch::Running) {
            child.wait().await?;
            *exit = ExitWatch::Exited;
        }
        Ok(())
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

/// Kills a process group. ESRCH, an empty group, is success: there is
/// nothing left to kill.
#[cfg(unix)]
fn kill_process_group(group: u32) -> std::io::Result<()> {
    let group = libc::pid_t::try_from(group).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("{group} is not a process group id"),
        )
    })?;
    // SAFETY: killpg only sends a signal; it touches no memory of ours.
    let result = unsafe { libc::killpg(group, libc::SIGKILL) };
    if result == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(std::io::Error::new(
        err.kind(),
        format!("could not kill the orchestrator's process group {group}: {err}"),
    ))
}

/// Blocks until `pid` has exited, leaving it unreaped.
#[cfg(unix)]
fn wait_unreaped(pid: u32) -> std::io::Result<()> {
    loop {
        // SAFETY: an all-zero siginfo_t is a valid value for waitid to fill.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: `info` is a valid, writable siginfo_t for the whole call.
        let result =
            unsafe { libc::waitid(libc::P_PID, pid, &mut info, libc::WEXITED | libc::WNOWAIT) };
        if result == 0 {
            return Ok(());
        }
        let err = std::io::Error::last_os_error();
        if err.kind() != std::io::ErrorKind::Interrupted {
            return Err(err);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn test_kill_process_group_reports_an_id_that_is_not_a_group() {
        let err = kill_process_group(u32::MAX).expect_err("not a pid_t");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }

    #[test]
    fn test_kill_process_group_treats_an_empty_group_as_killed() {
        // Above the default pid_max (4194304 at most on Linux), so no process
        // or group can have it.
        assert!(kill_process_group(1 << 30).is_ok());
    }
}
