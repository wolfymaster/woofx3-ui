//! `install_tls_provider` in a process of its own: any other test that
//! builds a rustls config installs a default provider as a side effect,
//! which would let this pass even if the function did nothing.

#[test]
fn test_install_tls_provider_installs_a_default_once_or_more() {
    assert!(
        rustls::crypto::CryptoProvider::get_default().is_none(),
        "nothing installs a provider before the test"
    );
    woofx3_companion_core::install_tls_provider();
    woofx3_companion_core::install_tls_provider();
    assert!(rustls::crypto::CryptoProvider::get_default().is_some());
}
