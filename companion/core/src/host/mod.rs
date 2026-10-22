//! The desktop host's side of a local engine: which mode the host runs in,
//! the supervision of the engine's orchestrator as the host's one sidecar
//! process, and registering with the engine as its client.

mod capnweb;
pub mod config;
mod engine;
mod error;
mod gateway;
pub mod registration;
pub mod sidecar;
pub mod status;

pub use config::{HostMode, LocalEngineSettings, HOST_CONFIG_FILE};
pub use engine::{orchestrator_spec, LocalEngineLayout, DEFAULT_API_PORT};
pub use error::HostError;
pub use gateway::{
    is_authentication_refused, ClientCredentials, EngineGateway, HttpEngineGateway,
    TwitchHelixFailure, TwitchHelixResult,
};
pub use registration::{
    run_registration, CredentialStore, LocalSession, Registrar, RegistrationOptions,
    CLIENT_DESCRIPTION,
};
pub use sidecar::{
    run_sidecar, run_sidecar_with, EnginePhase, EngineStatus, SidecarOptions, SidecarSpec,
    StopCause,
};
pub use status::{parse_status_line, ServiceStatus, StatusEvent, StatusLine};
