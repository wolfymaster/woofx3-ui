//! The companion's platform-independent pieces: the relay frame format,
//! reconnect backoff, OBS WebSocket discovery, the rules for which addresses
//! may be dialled, and the bridge that carries local WebSocket connections
//! over the relay. Nothing here depends on Tauri, so `cargo test` runs on any
//! OS.

pub mod address;
pub mod backoff;
pub mod frame;
pub mod obs_config;

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
