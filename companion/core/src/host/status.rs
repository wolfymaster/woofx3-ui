//! The orchestrator's status output: one JSON object per line on its stdout,
//! written when it runs with `WOOFX3_SUPERVISOR_STATUS=stdout-jsonl`. The
//! format is described under "Supervision by a parent process" in the
//! engine's docs/services/deployment.md, and written by `statusReporter` in
//! build/orchestrator/supervision.go.
//!
//! The orchestrator may add event types, fields and service statuses, and a
//! consumer must ignore what it does not know, so an unknown event or status
//! parses as [`StatusLine::Unknown`] rather than as an error.

use std::fmt;
use std::str::FromStr;

use serde::Deserialize;

use super::HostError;

/// What one status line said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusLine {
    Event(StatusEvent),
    /// An event type or service status this host does not know, or a blank
    /// line.
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusEvent {
    /// A service moved to `status`. `message` says how a stopped service
    /// exited, or why one was skipped.
    Service {
        name: String,
        status: ServiceStatus,
        pid: Option<u32>,
        message: Option<String>,
    },
    /// Every service is healthy at once. Sent once per orchestrator run.
    Ready,
    /// Every service has stopped and the orchestrator is exiting.
    Stopped,
    /// A service could not be started (`service` set), or the orchestrator
    /// could not start at all (`service` unset), in which case it exits
    /// after this line.
    Error {
        service: Option<String>,
        message: String,
    },
}

/// A service's state as the orchestrator reports it. Must match
/// `ServiceStatus.String` in the engine's build/orchestrator/main.go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStatus {
    Starting,
    Healthy,
    /// Running, but its health check timed out or failed. It is still
    /// checked, and turns healthy when a check passes.
    Unhealthy,
    Stopped,
    /// Not run, because its prebuilt binary is not installed.
    Skipped,
    /// A run-once step (the database migration) that exited with status 0.
    Completed,
}

/// A service status this host does not know.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownServiceStatus(pub String);

impl FromStr for ServiceStatus {
    type Err = UnknownServiceStatus;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "starting" => Ok(ServiceStatus::Starting),
            "healthy" => Ok(ServiceStatus::Healthy),
            "unhealthy" => Ok(ServiceStatus::Unhealthy),
            "stopped" => Ok(ServiceStatus::Stopped),
            "skipped" => Ok(ServiceStatus::Skipped),
            "completed" => Ok(ServiceStatus::Completed),
            other => Err(UnknownServiceStatus(other.to_string())),
        }
    }
}

impl fmt::Display for ServiceStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ServiceStatus::Starting => "starting",
            ServiceStatus::Healthy => "healthy",
            ServiceStatus::Unhealthy => "unhealthy",
            ServiceStatus::Stopped => "stopped",
            ServiceStatus::Skipped => "skipped",
            ServiceStatus::Completed => "completed",
        })
    }
}

/// The line as written. `time` is left out: the host has no use for the
/// orchestrator's clock.
#[derive(Deserialize)]
struct WireEvent {
    event: String,
    name: Option<String>,
    status: Option<String>,
    pid: Option<u32>,
    message: Option<String>,
}

/// Parses one line of status output. A line that is not JSON, or a known
/// event missing a field it always carries, is an error: the orchestrator
/// never writes either, so something else wrote to its stdout.
pub fn parse_status_line(line: &str) -> Result<StatusLine, HostError> {
    let line = line.trim_start_matches('\u{feff}').trim();
    if line.is_empty() {
        return Ok(StatusLine::Unknown);
    }
    let wire: WireEvent = serde_json::from_str(line).map_err(HostError::StatusLineUnreadable)?;
    let event = match wire.event.as_str() {
        "service" => {
            let name = required(&wire.event, "name", wire.name)?;
            let raw_status = required(&wire.event, "status", wire.status)?;
            let Ok(status) = raw_status.parse::<ServiceStatus>() else {
                return Ok(StatusLine::Unknown);
            };
            StatusEvent::Service {
                name,
                status,
                pid: wire.pid,
                message: wire.message.filter(|message| !message.is_empty()),
            }
        }
        "ready" => StatusEvent::Ready,
        "stopped" => StatusEvent::Stopped,
        "error" => StatusEvent::Error {
            service: wire.name.filter(|name| !name.is_empty()),
            message: required(&wire.event, "message", wire.message)?,
        },
        _ => return Ok(StatusLine::Unknown),
    };
    Ok(StatusLine::Event(event))
}

fn required(event: &str, field: &'static str, value: Option<String>) -> Result<String, HostError> {
    value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| HostError::StatusLineIncomplete {
            event: event.to_string(),
            field,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(
        name: &str,
        status: ServiceStatus,
        pid: Option<u32>,
        message: Option<&str>,
    ) -> StatusLine {
        StatusLine::Event(StatusEvent::Service {
            name: name.to_string(),
            status,
            pid,
            message: message.map(str::to_string),
        })
    }

    #[test]
    fn test_parse_status_line_reads_every_event_the_orchestrator_writes() {
        let cases: Vec<(&str, &str, StatusLine)> = vec![
            (
                "starting service",
                r#"{"event":"service","time":"2026-10-17T12:00:00.1Z","name":"api","status":"starting","pid":4242}"#,
                service("api", ServiceStatus::Starting, Some(4242), None),
            ),
            (
                "healthy service",
                r#"{"event":"service","time":"2026-10-17T12:00:03.2Z","name":"api","status":"healthy","pid":4242}"#,
                service("api", ServiceStatus::Healthy, Some(4242), None),
            ),
            (
                "unhealthy service",
                r#"{"event":"service","time":"t","name":"sceneManager","status":"unhealthy","pid":7}"#,
                service("sceneManager", ServiceStatus::Unhealthy, Some(7), None),
            ),
            (
                "stopped service with its exit",
                r#"{"event":"service","time":"t","name":"api","status":"stopped","pid":4242,"message":"exit status 0"}"#,
                service(
                    "api",
                    ServiceStatus::Stopped,
                    Some(4242),
                    Some("exit status 0"),
                ),
            ),
            (
                "skipped service without a pid",
                r#"{"event":"service","time":"t","name":"edge","status":"skipped","message":"prebuilt binary not installed"}"#,
                service(
                    "edge",
                    ServiceStatus::Skipped,
                    None,
                    Some("prebuilt binary not installed"),
                ),
            ),
            (
                "completed run-once step",
                r#"{"event":"service","time":"t","name":"migrate","status":"completed","pid":9,"message":"exit status 0"}"#,
                service(
                    "migrate",
                    ServiceStatus::Completed,
                    Some(9),
                    Some("exit status 0"),
                ),
            ),
            (
                "ready",
                r#"{"event":"ready","time":"2026-10-17T12:00:04.0Z"}"#,
                StatusLine::Event(StatusEvent::Ready),
            ),
            (
                "stopped",
                r#"{"event":"stopped","time":"2026-10-17T12:05:01.0Z"}"#,
                StatusLine::Event(StatusEvent::Stopped),
            ),
            (
                "service error",
                r#"{"event":"error","time":"t","name":"wooflow","message":"failed to start: binary not found"}"#,
                StatusLine::Event(StatusEvent::Error {
                    service: Some("wooflow".to_string()),
                    message: "failed to start: binary not found".to_string(),
                }),
            ),
            (
                "orchestrator error",
                r#"{"event":"error","time":"t","message":"services.json not found"}"#,
                StatusLine::Event(StatusEvent::Error {
                    service: None,
                    message: "services.json not found".to_string(),
                }),
            ),
        ];
        for (case, line, expected) in cases {
            let parsed = parse_status_line(line).unwrap_or_else(|err| panic!("{case}: {err}"));
            assert_eq!(parsed, expected, "{case}");
        }
    }

    #[test]
    fn test_parse_status_line_ignores_what_it_does_not_know() {
        let cases = [
            ("unknown event", r#"{"event":"draining","time":"t"}"#),
            (
                "unknown service status",
                r#"{"event":"service","time":"t","name":"api","status":"paused","pid":1}"#,
            ),
            ("blank line", ""),
            ("whitespace only", "   \t"),
        ];
        for (case, line) in cases {
            assert_eq!(
                parse_status_line(line).unwrap_or_else(|err| panic!("{case}: {err}")),
                StatusLine::Unknown,
                "{case}"
            );
        }
    }

    #[test]
    fn test_parse_status_line_tolerates_line_noise() {
        let cases = [
            ("carriage return", "{\"event\":\"ready\",\"time\":\"t\"}\r"),
            (
                "byte order mark",
                "\u{feff}{\"event\":\"ready\",\"time\":\"t\"}",
            ),
            (
                "surrounding spaces",
                "  {\"event\":\"ready\",\"time\":\"t\"}  ",
            ),
            (
                "unknown fields",
                r#"{"event":"ready","time":"t","services":3,"extra":{"a":1}}"#,
            ),
        ];
        for (case, line) in cases {
            assert_eq!(
                parse_status_line(line).unwrap_or_else(|err| panic!("{case}: {err}")),
                StatusLine::Event(StatusEvent::Ready),
                "{case}"
            );
        }
    }

    #[test]
    fn test_parse_status_line_rejects_what_the_orchestrator_never_writes() {
        let unreadable = [
            "Starting orchestrator",
            "{\"event\":",
            "[1,2,3]",
            "{\"time\":\"t\"}",
        ];
        for line in unreadable {
            assert!(
                matches!(
                    parse_status_line(line),
                    Err(HostError::StatusLineUnreadable(_))
                ),
                "{line}"
            );
        }
        let incomplete = [
            (r#"{"event":"service","status":"healthy"}"#, "name"),
            (r#"{"event":"service","name":"api"}"#, "status"),
            (
                r#"{"event":"service","name":"","status":"healthy"}"#,
                "name",
            ),
            (r#"{"event":"error","name":"api"}"#, "message"),
        ];
        for (line, missing) in incomplete {
            match parse_status_line(line) {
                Err(HostError::StatusLineIncomplete { field, .. }) => {
                    assert_eq!(field, missing, "{line}")
                }
                other => panic!("{line}: expected a missing {missing}, got {other:?}"),
            }
        }
    }

    #[test]
    fn test_service_status_round_trips_through_its_wire_name() {
        for status in [
            ServiceStatus::Starting,
            ServiceStatus::Healthy,
            ServiceStatus::Unhealthy,
            ServiceStatus::Stopped,
            ServiceStatus::Skipped,
            ServiceStatus::Completed,
        ] {
            assert_eq!(status.to_string().parse::<ServiceStatus>(), Ok(status));
        }
        assert_eq!(
            "Healthy".parse::<ServiceStatus>(),
            Err(UnknownServiceStatus("Healthy".to_string()))
        );
    }
}
