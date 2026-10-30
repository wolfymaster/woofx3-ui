//! The desktop host's side of a local engine: which mode the host runs in,
//! the supervision of the engine's orchestrator as the host's one sidecar
//! process, registering with the engine as its client, and the UI state the
//! host keeps for its window in local mode (the shoutout queue and the
//! stream start marker).

mod capnweb;
pub mod config;
mod engine;
mod error;
#[cfg(test)]
mod fake_engine;
mod gateway;
pub mod registration;
pub mod shoutouts;
pub mod sidecar;
pub mod status;
pub mod stream_marker;

pub use config::{
    choose_host_mode, HostConfig, HostMode, HostModeKind, LocalEngineSettings, HOST_CONFIG_FILE,
};
pub use engine::{orchestrator_spec, LocalEngineLayout, DEFAULT_API_PORT};
pub use error::HostError;
pub use gateway::{
    is_authentication_refused, ClientCredentials, EngineGateway, GatewayTimeouts,
    HttpEngineGateway, StreamLiveness, TwitchHelixFailure, TwitchHelixResult,
};
pub use registration::{
    run_registration, CredentialRefusals, CredentialStore, LocalSession, Registrar,
    RegistrationOptions, CLIENT_DESCRIPTION,
};
pub use shoutouts::{
    run_shoutout_pacing, ShoutoutChannel, ShoutoutEnqueued, ShoutoutEntry, ShoutoutEntryId,
    ShoutoutOptions, ShoutoutQueue, ShoutoutQueueView, ShoutoutQueueWatch,
};
pub use sidecar::{
    run_sidecar, run_sidecar_with, EnginePhase, EngineStatus, SidecarOptions, SidecarSpec,
    StopCause,
};
pub use status::{parse_status_line, ServiceStatus, StatusEvent, StatusLine};
pub use stream_marker::{
    run_stream_marker, MarkerRequestOutcome, StreamMarkerOptions, StreamMarkerRequests,
    StreamStartMarker,
};
