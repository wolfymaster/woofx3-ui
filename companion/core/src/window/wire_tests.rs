//! Golden JSON for the wire shapes where serde and the generated TypeScript
//! could disagree: internally tagged unions, `flatten`, a newtype id, and
//! the arguments the window sends. The bindings are generated from the same
//! serde attributes, but ts-rs skips an attribute it does not understand
//! (with only a build warning), and a hand-written `Serialize` would replace
//! the derive; either would leave the TypeScript describing JSON the host
//! no longer writes, with the staleness test still green.

use serde_json::json;

use super::*;
use crate::host::{
    ShoutoutChannel, ShoutoutEnqueued, ShoutoutEntryId, ShoutoutQueueView, StreamStartMarker,
};

fn wire<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).expect("serializes")
}

#[test]
fn test_window_wire_tagged_unions_carry_their_kind_and_camel_case_fields() {
    assert_eq!(
        wire(&CompanionState::Pairing {
            user_code: "BCDF-GHJK".into(),
            verification_url: "https://example.test/pair".into(),
            expires_at: 1_700_000_000_000,
        }),
        json!({
            "kind": "pairing",
            "userCode": "BCDF-GHJK",
            "verificationUrl": "https://example.test/pair",
            "expiresAt": 1_700_000_000_000u64,
        })
    );
    assert_eq!(
        wire(&CompanionState::Starting),
        json!({ "kind": "starting" })
    );
    assert_eq!(
        wire(&DiscoveryView::Found {
            port: 4455,
            has_password: true
        }),
        json!({ "kind": "found", "port": 4455, "hasPassword": true })
    );
    assert_eq!(
        wire(&LocalEngineSession::Ready {
            api_url: "http://127.0.0.1:5050/api".into(),
            client_id: "id".into(),
            client_secret: "secret".into(),
        }),
        json!({
            "kind": "ready",
            "apiUrl": "http://127.0.0.1:5050/api",
            "clientId": "id",
            "clientSecret": "secret",
        })
    );
    assert_eq!(
        wire(&StreamStartMarker::Pending { requested_at: 7 }),
        json!({ "kind": "pending", "requestedAt": 7 })
    );
    assert_eq!(
        wire(&AddressView {
            display: "127.0.0.1:4455".into(),
            origin: crate::AddressOrigin::Discovered,
        }),
        json!({ "display": "127.0.0.1:4455", "origin": "discovered" })
    );
}

/// `WindowState` flattens the pairing state's fields next to `update`.
#[test]
fn test_window_wire_window_state_flattens_the_pairing_state() {
    assert_eq!(
        wire(&WindowState {
            state: CompanionState::Paired {
                instance_name: "x".into(),
                cloud_connected: false,
            },
            update: Some(ReadyUpdate {
                product_name: "woofx3 companion".into(),
                version: "1.2.3".into(),
            }),
        }),
        json!({
            "kind": "paired",
            "instanceName": "x",
            "cloudConnected": false,
            "update": { "productName": "woofx3 companion", "version": "1.2.3" },
        })
    );
    assert_eq!(
        wire(&WindowState {
            state: CompanionState::Unpaired,
            update: None,
        }),
        json!({ "kind": "unpaired", "update": null })
    );
}

/// The entry id is a bare number on the wire, both ways.
#[test]
fn test_window_wire_entry_id_is_a_bare_number() {
    assert_eq!(wire(&ShoutoutEntryId(42)), json!(42));
    assert_eq!(
        wire(&ShoutoutEnqueued {
            id: ShoutoutEntryId(3),
            position: 2,
            already_queued: true,
        }),
        json!({ "id": 3, "position": 2, "alreadyQueued": true })
    );
    assert_eq!(
        wire(&ShoutoutQueueView {
            entries: Vec::new(),
            paused_reason: None,
        }),
        json!({ "entries": [], "pausedReason": null })
    );
    let read: ShoutoutEntryId = serde_json::from_value(json!(7)).expect("reads");
    assert_eq!(read, ShoutoutEntryId(7));
    assert!(serde_json::from_value::<ShoutoutEntryId>(json!([7])).is_err());
}

/// What the window sends as each command's `args`.
#[test]
fn test_window_wire_reads_command_arguments() {
    let read: SetEndpointEnabledArgs = serde_json::from_value(json!({
        "moduleId": "woofx3_obs",
        "endpointId": "obs",
        "enabled": true,
    }))
    .expect("reads");
    assert_eq!(
        read,
        SetEndpointEnabledArgs {
            module_id: "woofx3_obs".into(),
            endpoint_id: "obs".into(),
            enabled: true,
        }
    );
    let read: ReorderShoutoutsArgs =
        serde_json::from_value(json!({ "entryIds": [2, 0] })).expect("reads");
    assert_eq!(read.entry_ids, [ShoutoutEntryId(2), ShoutoutEntryId(0)]);
    let read: EnqueueShoutoutArgs = serde_json::from_value(json!({
        "channel": {
            "twitchUserId": "42",
            "login": "wolfy",
            "displayName": "Wolfy",
            "profileImageUrl": null,
            "broadcasterType": null,
        }
    }))
    .expect("reads");
    assert_eq!(
        read.channel,
        ShoutoutChannel {
            twitch_user_id: "42".into(),
            login: "wolfy".into(),
            display_name: "Wolfy".into(),
            profile_image_url: None,
            broadcaster_type: None,
        }
    );
    assert!(
        serde_json::from_value::<RemoveShoutoutArgs>(json!({ "entry_id": 1 })).is_err(),
        "the window's names are camelCase"
    );
}
