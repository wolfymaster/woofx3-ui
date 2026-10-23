//! The arguments of each command that takes any, as the window sends them:
//! one struct per command, which the command takes as its one `args`
//! parameter. The window's types for them are generated from these, so a
//! renamed field changes both sides at once.

use serde::Deserialize;

use crate::host::{ShoutoutChannel, ShoutoutEntryId};

/// Turns an integration endpoint on or off. On needs an address,
/// discovered or confirmed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SetEndpointEnabledArgs {
    pub module_id: String,
    pub endpoint_id: String,
    pub enabled: bool,
}

/// The `host:port` the streamer typed and confirmed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ConfirmAddressArgs {
    pub module_id: String,
    pub endpoint_id: String,
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct UseDiscoveredArgs {
    pub module_id: String,
    pub endpoint_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SetSharePasswordArgs {
    pub module_id: String,
    pub endpoint_id: String,
    pub share: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct TestEndpointArgs {
    pub module_id: String,
    pub endpoint_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EnqueueShoutoutArgs {
    pub channel: ShoutoutChannel,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RemoveShoutoutArgs {
    pub entry_id: ShoutoutEntryId,
}

/// The queue's new order. An id no longer queued is skipped; entries left
/// out keep their order after the ones named.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReorderShoutoutsArgs {
    pub entry_ids: Vec<ShoutoutEntryId>,
}
