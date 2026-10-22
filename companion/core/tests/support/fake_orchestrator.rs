//! A stand-in for the engine's orchestrator, run by tests/sidecar.rs as a real
//! child process. It writes status lines the way the orchestrator does and
//! behaves as `FAKE_ORCHESTRATOR_SCRIPT` says:
//!
//! - `ready`: reports two services healthy and the engine ready, then stops
//!   them when stdin closes, as `--exit-on-stdin-eof` does.
//! - `fail`: reports a startup error and exits 1, as when services.json is
//!   missing.
//! - `fail-runs:<n>`: fails on its first `n` runs, then behaves as `ready`.
//!   Runs are counted in `FAKE_ORCHESTRATOR_RUNS`.
//! - `ready-then-exit:<ms>`: reports ready, then exits 1 after `ms`.
//! - `ready-then-exit-cleanly`: reports ready, then stops its services and
//!   exits 0 without being asked, as after a SIGTERM from elsewhere.
//! - `stubborn`: reports ready, then ignores stdin closing.
//! - `stubborn-with-service`: as `stubborn`, after starting a service that
//!   also never exits.
//! - `fail-leaving-service`: starts a service that never exits, then exits 1.
//! - `linger`: a service that never exits.
//!
//! With `FAKE_ORCHESTRATOR_RECORD` set, it appends what it was started with to
//! that file, one `key=value` per line. The service pid is recorded as
//! `service_pid`.

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

const SCRIPT_ENV: &str = "FAKE_ORCHESTRATOR_SCRIPT";
const RECORD_ENV: &str = "FAKE_ORCHESTRATOR_RECORD";
const RUNS_ENV: &str = "FAKE_ORCHESTRATOR_RUNS";

fn main() {
    let script = std::env::var(SCRIPT_ENV).unwrap_or_default();
    if script == "linger" {
        linger();
    }
    record_start();
    let run = count_run();
    match script.split_once(':').unwrap_or((script.as_str(), "")) {
        ("ready", _) => ready_until_stdin_closes(),
        ("fail", _) => fail(),
        ("fail-runs", runs) => {
            if run <= parse_number(runs) {
                fail();
            }
            ready_until_stdin_closes();
        }
        ("ready-then-exit", ms) => {
            report_ready();
            std::thread::sleep(Duration::from_millis(parse_number(ms)));
            std::process::exit(1);
        }
        ("ready-then-exit-cleanly", _) => {
            report_ready();
            report_stopped();
            std::process::exit(0);
        }
        ("stubborn", _) => {
            report_ready();
            ignore_stdin_and_linger();
        }
        ("stubborn-with-service", _) => {
            start_service();
            report_ready();
            ignore_stdin_and_linger();
        }
        ("fail-leaving-service", _) => {
            start_service();
            fail();
        }
        (other, _) => {
            eprintln!("fake orchestrator: unknown script {other:?}");
            std::process::exit(2);
        }
    }
}

fn status(line: &str) {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{line}").expect("stdout is open");
    stdout.flush().expect("stdout flushes");
}

fn report_ready() {
    let pid = std::process::id();
    status(&format!(
        r#"{{"event":"service","time":"t","name":"api","status":"starting","pid":{pid}}}"#
    ));
    // What a newer orchestrator might add, and a blank line: both ignored.
    status(r#"{"event":"progress","time":"t","percent":50}"#);
    status("");
    status(&format!(
        r#"{{"event":"service","time":"t","name":"api","status":"healthy","pid":{pid}}}"#
    ));
    status(&format!(
        r#"{{"event":"service","time":"t","name":"sceneManager","status":"healthy","pid":{pid}}}"#
    ));
    status(r#"{"event":"ready","time":"t"}"#);
}

fn ready_until_stdin_closes() -> ! {
    report_ready();
    wait_for_stdin_to_close();
    report_stopped();
    std::process::exit(0);
}

fn report_stopped() {
    let pid = std::process::id();
    status(&format!(
        r#"{{"event":"service","time":"t","name":"api","status":"stopped","pid":{pid},"message":"exit status 0"}}"#
    ));
    status(r#"{"event":"stopped","time":"t"}"#);
}

fn fail() -> ! {
    eprintln!("fake orchestrator: giving up");
    status(r#"{"event":"error","time":"t","message":"services.json not found"}"#);
    std::process::exit(1);
}

fn wait_for_stdin_to_close() {
    let mut sink = Vec::new();
    // An error ends the read just as EOF does, which is what the real
    // orchestrator does too.
    let _ = std::io::stdin().lock().read_to_end(&mut sink);
}

fn ignore_stdin_and_linger() -> ! {
    wait_for_stdin_to_close();
    linger();
}

fn linger() -> ! {
    loop {
        std::thread::sleep(Duration::from_secs(60));
    }
}

/// Starts a copy of this program as a service that never exits, in this
/// process's group, as the real orchestrator starts its services.
fn start_service() {
    let mut child = Command::new(std::env::current_exe().expect("own path"))
        .env(SCRIPT_ENV, "linger")
        .env_remove(RECORD_ENV)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("the service starts");
    append_record(&format!("service_pid={}", child.id()));
    // Reaps the service should it end while this process still runs.
    std::thread::spawn(move || child.wait());
}

fn record_start() {
    append_record(&format!("pid={}", std::process::id()));
    for arg in std::env::args().skip(1) {
        append_record(&format!("arg={arg}"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        append_record(&format!("cwd={}", cwd.display()));
    }
    for (key, value) in std::env::vars() {
        if key.starts_with("WOOFX3_") || key.starts_with("FAKE_ENGINE_") {
            append_record(&format!("env:{key}={value}"));
        }
    }
}

fn append_record(line: &str) {
    let Ok(path) = std::env::var(RECORD_ENV) else {
        return;
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .expect("the record file opens");
    writeln!(file, "{line}").expect("the record is written");
}

/// Which run this is, counting from 1, when `FAKE_ORCHESTRATOR_RUNS` names a
/// counter file.
fn count_run() -> u64 {
    let Ok(path) = std::env::var(RUNS_ENV) else {
        return 1;
    };
    let path = Path::new(&path);
    let previous = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let run = previous + 1;
    std::fs::write(path, run.to_string()).expect("the run counter is written");
    run
}

fn parse_number(raw: &str) -> u64 {
    raw.parse()
        .unwrap_or_else(|_| panic!("fake orchestrator: {raw:?} is not a number"))
}
