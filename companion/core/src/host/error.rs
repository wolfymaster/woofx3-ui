use std::path::PathBuf;

/// What can go wrong reading the host's configuration or the orchestrator's
/// status output.
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("the orchestrator wrote a status line this host cannot read: {0}")]
    StatusLineUnreadable(#[source] serde_json::Error),
    #[error("the orchestrator's `{event}` status line has no `{field}`")]
    StatusLineIncomplete { event: String, field: &'static str },
    #[error("could not read the host configuration at {path}: {source}")]
    ConfigUnreadable {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("the host configuration at {path} is invalid: {source}")]
    ConfigInvalid {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("`engineDir` in the host configuration must be an absolute path, not {0}")]
    EngineDirNotAbsolute(PathBuf),
    #[error("there is no engine orchestrator at {0}")]
    OrchestratorMissing(PathBuf),
    #[error("the engine's data directory must be an absolute path, not {0}")]
    DataDirNotAbsolute(PathBuf),
    #[error("the engine's data directory {0} is inside the engine release")]
    DataDirInsideEngine(PathBuf),
}
