//! The desktop host's side of a local engine: which mode the host runs in,
//! and the supervision of the engine's orchestrator as the host's one
//! sidecar process.

pub mod config;
mod engine;
mod error;
pub mod sidecar;
pub mod status;

pub use config::{HostMode, LocalEngineSettings, HOST_CONFIG_FILE};
pub use engine::orchestrator_spec;
pub use error::HostError;
pub use sidecar::{
    run_sidecar, run_sidecar_with, EnginePhase, EngineStatus, SidecarOptions, SidecarSpec,
    StopCause,
};
pub use status::{parse_status_line, ServiceStatus, StatusEvent, StatusLine};
