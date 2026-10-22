/// Calls `$callback!` with every command the window may call. Written once
/// so nothing that lists the commands can drift: the host passes the list to
/// `generate_handler!` (companion/src-tauri/src/lib.rs), and its build script
/// turns it into the `allow-<name>` permissions that
/// companion/src-tauri/capabilities/main.json grants. A handler missing a
/// permission would be denied at runtime.
macro_rules! with_command_names {
    ($callback:ident) => {
        $callback!(
            get_state,
            start_pairing,
            cancel_pairing,
            open_verification_url,
            confirm_pairing,
            reject_pairing,
            unpair,
            install_update,
            get_integrations,
            set_endpoint_enabled,
            confirm_address,
            use_discovered,
            set_share_password,
            test_endpoint,
            reconnect_relay,
            local_engine_session,
            shoutout_queue,
            enqueue_shoutout,
            remove_shoutout,
            reorder_shoutouts,
            stream_start_marker,
            request_stream_start_marker
        )
    };
}
