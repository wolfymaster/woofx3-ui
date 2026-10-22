/// Calls `$callback!` with every command the window may call, as
/// `name(Args) -> Result`. Written once so nothing that lists the commands
/// can drift:
///
/// - the host passes the names to `generate_handler!`
///   (companion/src-tauri/src/lib.rs);
/// - its build script turns them into the `allow-<name>` permissions that
///   companion/src-tauri/capabilities/main.json grants, since a handler
///   missing a permission would be denied at runtime;
/// - the window's generated bindings name each command, its arguments and
///   its result from it.
///
/// A command with arguments takes them as its one parameter, named `args`,
/// of the `Args` type listed here; `()` means it takes none. The host's
/// build script reads this file with `include!`, so it holds only the macro.
#[macro_export]
macro_rules! with_command_names {
    ($callback:ident) => {
        $callback!(
            get_state(()) -> WindowState,
            start_pairing(()) -> (),
            cancel_pairing(()) -> (),
            open_verification_url(()) -> (),
            confirm_pairing(()) -> (),
            reject_pairing(()) -> (),
            unpair(()) -> (),
            install_update(()) -> (),
            get_integrations(()) -> IntegrationsView,
            set_endpoint_enabled(SetEndpointEnabledArgs) -> (),
            confirm_address(ConfirmAddressArgs) -> (),
            use_discovered(UseDiscoveredArgs) -> (),
            set_share_password(SetSharePasswordArgs) -> (),
            test_endpoint(TestEndpointArgs) -> TestResult,
            reconnect_relay(()) -> (),
            local_engine_session(()) -> LocalEngineSession,
            shoutout_queue(()) -> ShoutoutQueueView,
            enqueue_shoutout(EnqueueShoutoutArgs) -> ShoutoutEnqueued,
            remove_shoutout(RemoveShoutoutArgs) -> (),
            reorder_shoutouts(ReorderShoutoutsArgs) -> (),
            stream_start_marker(()) -> StreamStartMarker,
            request_stream_start_marker(()) -> MarkerRequestOutcome
        )
    };
}
