use std::path::PathBuf;

/// What can go wrong running a local engine: reading the host's
/// configuration and the orchestrator's status, and registering with the
/// engine.
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
    #[error("`apiPort` in the host configuration cannot be 0")]
    ApiPortZero,
    #[error("there is no engine orchestrator at {0}")]
    OrchestratorMissing(PathBuf),
    /// The engine answered a call with an error: a refused registration, or
    /// a failure inside the engine.
    #[error("the engine refused: {name}: {message}")]
    EngineRefused { name: String, message: String },
    /// `authenticate` refused the credentials, so the engine does not know
    /// them (see `is_authentication_refused`).
    #[error("the engine does not accept this host's credentials: {message}")]
    CredentialsRefused { message: String },
    /// The engine ended the capnweb session instead of answering.
    #[error("the engine ended the session: {name}: {message}")]
    EngineSessionAborted { name: String, message: String },
    #[error("could not set up the HTTP client for the engine: {0}")]
    HttpClientBuild(#[source] reqwest::Error),
    #[error("could not reach the engine: {0}")]
    EngineUnreachable(#[source] reqwest::Error),
    #[error("the engine answered HTTP {0}")]
    EngineHttpStatus(u16),
    #[error("the engine's reply could not be read: {0}")]
    EngineReplyUnreadable(&'static str),
    #[error("could not read the engine's registration token at {path}: {source}")]
    RegistrationTokenUnreadable {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("the engine's registration token file at {0} is empty")]
    RegistrationTokenEmpty(PathBuf),
    #[error("could not read the engine client credentials: {0:#}")]
    CredentialStoreRead(#[source] anyhow::Error),
    #[error("could not save the engine client credentials: {0:#}")]
    CredentialStoreWrite(#[source] anyhow::Error),
    #[error("the engine's data directory must be an absolute path, not {0}")]
    DataDirNotAbsolute(PathBuf),
    #[error("the engine's data directory {0} is inside the engine release")]
    DataDirInsideEngine(PathBuf),
    #[error("cannot queue this shoutout: {0}")]
    ShoutoutChannelInvalid(&'static str),
    #[error("the shoutout queue is full: it holds at most {0} channels")]
    ShoutoutQueueFull(usize),
    #[error("there is no shoutout queue entry {0}")]
    ShoutoutEntryNotFound(u64),
}
