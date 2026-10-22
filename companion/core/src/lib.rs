//! The companion's platform-independent pieces: the relay frame format,
//! reconnect backoff, OBS WebSocket discovery, the rules for which addresses
//! may be dialled, the bridge that carries local WebSocket connections over
//! the relay, and the desktop host's supervision of a local engine. Nothing
//! here depends on Tauri, so `cargo test` runs on any OS.

pub mod address;
pub mod backoff;
pub mod bridge;
mod budget;
pub mod frame;
pub mod host;
pub mod obs_config;
pub mod relay;

pub use address::{AddressOrigin, ConfirmedAddress};
pub use bridge::{probe, EndpointResolver, ProbeOutcome};
pub use relay::{
    run_relay, run_relay_with, CredentialSource, RelayGrant, RelayOptions, RelayStatus, Stopped,
};

/// Installs ring as the process's rustls crypto provider. rustls adopts it
/// on its own only when something builds a config through rustls first, as
/// the Convex and relay WebSockets do; reqwest instead panics when no
/// provider is installed. The updater's HTTP client, and anything else built
/// before a WebSocket connects (always, on a companion that is not paired),
/// needs it installed up front. Safe to call more than once.
pub fn install_tls_provider() {
    // Fails only when a provider is already installed, which is the outcome
    // wanted.
    let _already_installed = rustls::crypto::ring::default_provider().install_default();
}

#[cfg(test)]
mod tests {
    /// tokio-tungstenite builds its TLS config with `ClientConfig::builder()`,
    /// which panics unless rustls has exactly one crypto provider compiled in.
    #[test]
    fn rustls_has_a_default_crypto_provider() {
        let _ = rustls::ClientConfig::builder()
            .with_root_certificates(rustls::RootCertStore::empty())
            .with_no_client_auth();
    }
}
