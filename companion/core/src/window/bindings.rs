//! Renders the window's TypeScript bindings: every wire type the window
//! reads or sends, the event names, and the command names, in one file.
//! `examples/write_window_bindings.rs` writes it, and a test fails while the
//! committed file differs, so the window never compiles against stale types.

use std::any::TypeId;

use ts_rs::{Config, TS};

use super::{
    AddressView, AppLinkStart, Availability, ChooseHostModeArgs, CompanionLinkStatus,
    CompanionState, ConfirmAddressArgs, DiscoveryView, EndpointView, EnqueueShoutoutArgs,
    FinishAppLinkArgs, HostModeView, IntegrationsView, LinkedInstance, LocalEngineSession,
    ModuleView, OpenTwitchSignInArgs, ReadyUpdate, RelayView, RemoveShoutoutArgs,
    ReorderShoutoutsArgs, SetEndpointEnabledArgs, SetSharePasswordArgs, TestEndpointArgs,
    TestResult, UseDiscoveredArgs, WindowState, COMMAND_NAMES, INTEGRATIONS_EVENT,
    SHOUTOUT_QUEUE_EVENT, STATE_EVENT, STREAM_START_MARKER_EVENT,
};
use crate::host::{
    HostModeKind, MarkerRequestOutcome, ShoutoutChannel, ShoutoutEnqueued, ShoutoutEntry,
    ShoutoutEntryId, ShoutoutQueueView, StreamStartMarker,
};
use crate::AddressOrigin;

/// Where the bindings live, relative to the companion directory.
pub const BINDINGS_FILE: &str = "ui/src/generated/window.ts";

const HEADER: &str = "\
// Generated from the Rust wire types in companion/core (src/window/bindings.rs).
// Do not edit. To regenerate, run in companion/core:
//   cargo run --features ts --example write_window_bindings
";

/// One declaration, with its doc comment as JSDoc.
fn declaration<T: TS>(cfg: &Config) -> String {
    let docs = T::docs().unwrap_or_default();
    format!("{docs}export {}\n", T::decl(cfg))
}

/// Renders a type's TypeScript name.
type TypeName = fn(&Config) -> String;

/// A command's result type: `void` for `()`, which Tauri resolves as
/// nothing, rather than ts-rs's `null`.
fn result_type<T: TS + 'static>(cfg: &Config) -> String {
    if TypeId::of::<T>() == TypeId::of::<()>() {
        return "void".to_string();
    }
    T::name(cfg)
}

/// Each command's name, and its argument and result types' names. Arguments
/// of `()` are `null`: the command takes none.
macro_rules! command_types {
    ($($name:ident($args:ty) -> $result:ty),* $(,)?) => {
        vec![$((
            stringify!($name),
            <$args as TS>::name as TypeName,
            result_type::<$result> as TypeName,
        )),*]
    };
}

fn command_types() -> Vec<(&'static str, TypeName, TypeName)> {
    crate::with_command_names!(command_types)
}

/// The file's contents.
pub fn window_bindings() -> String {
    // serde writes every integer as a JSON number, so the bindings type them
    // as `number` rather than ts-rs's default `bigint`. That holds only for
    // values up to `MAX_SAFE_INTEGER` (2^53 - 1): epoch milliseconds, ids,
    // ports and counts all are. A field that could pass it must not be
    // added as an integer; send it as a string.
    let cfg = Config::new().with_large_int("number");
    let declarations = [
        declaration::<CompanionState>(&cfg),
        declaration::<ReadyUpdate>(&cfg),
        declaration::<WindowState>(&cfg),
        declaration::<Availability>(&cfg),
        declaration::<RelayView>(&cfg),
        declaration::<DiscoveryView>(&cfg),
        declaration::<AddressOrigin>(&cfg),
        declaration::<AddressView>(&cfg),
        declaration::<EndpointView>(&cfg),
        declaration::<ModuleView>(&cfg),
        declaration::<IntegrationsView>(&cfg),
        declaration::<TestResult>(&cfg),
        declaration::<LocalEngineSession>(&cfg),
        declaration::<ShoutoutEntryId>(&cfg),
        declaration::<ShoutoutChannel>(&cfg),
        declaration::<ShoutoutEntry>(&cfg),
        declaration::<ShoutoutQueueView>(&cfg),
        declaration::<ShoutoutEnqueued>(&cfg),
        declaration::<StreamStartMarker>(&cfg),
        declaration::<MarkerRequestOutcome>(&cfg),
        declaration::<HostModeKind>(&cfg),
        declaration::<HostModeView>(&cfg),
        declaration::<LinkedInstance>(&cfg),
        declaration::<CompanionLinkStatus>(&cfg),
        declaration::<AppLinkStart>(&cfg),
        declaration::<SetEndpointEnabledArgs>(&cfg),
        declaration::<ConfirmAddressArgs>(&cfg),
        declaration::<UseDiscoveredArgs>(&cfg),
        declaration::<SetSharePasswordArgs>(&cfg),
        declaration::<TestEndpointArgs>(&cfg),
        declaration::<EnqueueShoutoutArgs>(&cfg),
        declaration::<RemoveShoutoutArgs>(&cfg),
        declaration::<ReorderShoutoutsArgs>(&cfg),
        declaration::<ChooseHostModeArgs>(&cfg),
        declaration::<FinishAppLinkArgs>(&cfg),
        declaration::<OpenTwitchSignInArgs>(&cfg),
    ];
    let events = [
        ("STATE_EVENT", STATE_EVENT),
        ("INTEGRATIONS_EVENT", INTEGRATIONS_EVENT),
        ("SHOUTOUT_QUEUE_EVENT", SHOUTOUT_QUEUE_EVENT),
        ("STREAM_START_MARKER_EVENT", STREAM_START_MARKER_EVENT),
    ];

    let mut out = String::from(HEADER);
    for declaration in declarations {
        out.push('\n');
        out.push_str(&declaration);
    }
    out.push('\n');
    for (name, value) in events {
        out.push_str(&format!("export const {name} = {value:?};\n"));
    }
    out.push_str(
        "\n/** Every command the window may call, by its name. */\nexport const COMMANDS = {\n",
    );
    for name in COMMAND_NAMES {
        out.push_str(&format!("  {name}: {name:?},\n"));
    }
    out.push_str(
        "} as const;\n\nexport type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];\n",
    );
    let commands: Vec<(&str, String, String)> = command_types()
        .into_iter()
        .map(|(name, args, result)| (name, args(&cfg), result(&cfg)))
        .collect();
    out.push_str("\n/** Each command's arguments, its one `args` parameter; null for none. */\n");
    out.push_str("export type CommandArgs = {\n");
    for (name, args, _) in &commands {
        out.push_str(&format!("  {name}: {args};\n"));
    }
    out.push_str("};\n\n/** What each command resolves to. */\n");
    out.push_str("export type CommandResults = {\n");
    for (name, _, result) in &commands {
        out.push_str(&format!("  {name}: {result};\n"));
    }
    out.push_str("};\n");
    out
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn test_window_bindings_are_up_to_date() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(BINDINGS_FILE);
        let committed = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("cannot read {}: {err}", path.display()));
        assert!(
            committed == window_bindings(),
            "{} is stale: run `cargo run --features ts --example write_window_bindings` in companion/core",
            path.display()
        );
    }
}
