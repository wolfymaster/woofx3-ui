/// Every command the window may call. build.rs turns each into an
/// `allow-<name>` permission, and capabilities/main.json grants them, so a
/// command missing here cannot be called. Must list exactly the commands in
/// `generate_handler!` in lib.rs.
pub const COMMAND_NAMES: &[&str] = &[
    "get_state",
    "start_pairing",
    "cancel_pairing",
    "open_verification_url",
    "confirm_pairing",
    "reject_pairing",
    "unpair",
    "install_update",
    "get_integrations",
    "set_endpoint_enabled",
    "confirm_address",
    "use_discovered",
    "set_share_password",
    "test_endpoint",
    "reconnect_relay",
    "local_engine_session",
];
