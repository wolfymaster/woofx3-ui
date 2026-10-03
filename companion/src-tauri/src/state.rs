use serde::Serialize;

/// Where pairing stands. Serialized with `kind` as the tag; must match
/// `CompanionState` in companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CompanionState {
    Starting,
    /// A stored token exists but Convex has not answered yet, so whether it
    /// is still paired, or confirmed, cannot be told.
    Offline,
    Unpaired,
    /// `expires_at` is milliseconds since the epoch on this PC's clock.
    #[serde(rename_all = "camelCase")]
    Pairing {
        user_code: String,
        verification_url: String,
        expires_at: u64,
    },
    /// Approved in the browser; waiting for the person at this PC to confirm
    /// that the instance and the approver are theirs.
    #[serde(rename_all = "camelCase")]
    ConfirmPairing {
        instance_name: String,
        approved_by: String,
    },
    #[serde(rename_all = "camelCase")]
    Paired {
        instance_name: String,
        cloud_connected: bool,
    },
    Error {
        message: String,
    },
}

impl CompanionState {
    /// The one-line summary on the tray menu.
    pub fn tray_label(&self) -> String {
        match self {
            CompanionState::Starting => "Starting…".to_string(),
            CompanionState::Offline => "Offline".to_string(),
            CompanionState::Unpaired | CompanionState::Error { .. } => "Not paired".to_string(),
            CompanionState::Pairing { .. } => "Pairing…".to_string(),
            CompanionState::ConfirmPairing { .. } => "Waiting for you to confirm".to_string(),
            CompanionState::Paired {
                instance_name,
                cloud_connected: true,
            } => format!("Paired with {instance_name}"),
            CompanionState::Paired {
                cloud_connected: false,
                ..
            } => "Offline".to_string(),
        }
    }
}

/// What the window renders: where pairing stands, plus the update waiting to
/// be installed, if any. The pairing state's fields sit at the top level next
/// to `update`. Must match `WindowState` in companion/ui/src/state.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WindowState {
    #[serde(flatten)]
    pub state: CompanionState,
    pub update: Option<ReadyUpdate>,
}

/// A newer release, downloaded and verified, that installs on Restart to
/// update.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReadyUpdate {
    pub version: String,
}

impl ReadyUpdate {
    /// The tray menu item that installs it.
    pub fn tray_label(&self) -> String {
        format!("Restart to update to {}", self.version)
    }
}

/// Must match `STATE_EVENT` in companion/ui/src/state.ts.
pub const STATE_EVENT: &str = "companion://state";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn wire(state: CompanionState) -> serde_json::Value {
        serde_json::to_value(state).expect("state serializes")
    }

    #[test]
    fn serializes_each_variant_as_the_typescript_mirror_expects() {
        assert_eq!(
            wire(CompanionState::Starting),
            json!({ "kind": "starting" })
        );
        assert_eq!(
            wire(CompanionState::Unpaired),
            json!({ "kind": "unpaired" })
        );
        assert_eq!(wire(CompanionState::Offline), json!({ "kind": "offline" }));
        assert_eq!(
            wire(CompanionState::Pairing {
                user_code: "BCDF-GHJK".into(),
                verification_url: "https://example.test/companion/pair?code=BCDF-GHJK".into(),
                expires_at: 1_700_000_000_000,
            }),
            json!({
                "kind": "pairing",
                "userCode": "BCDF-GHJK",
                "verificationUrl": "https://example.test/companion/pair?code=BCDF-GHJK",
                "expiresAt": 1_700_000_000_000u64,
            })
        );
        assert_eq!(
            wire(CompanionState::ConfirmPairing {
                instance_name: "x".into(),
                approved_by: "y".into(),
            }),
            json!({ "kind": "confirmPairing", "instanceName": "x", "approvedBy": "y" })
        );
        assert_eq!(
            wire(CompanionState::Paired {
                instance_name: "x".into(),
                cloud_connected: true,
            }),
            json!({ "kind": "paired", "instanceName": "x", "cloudConnected": true })
        );
        assert_eq!(
            wire(CompanionState::Error {
                message: "m".into()
            }),
            json!({ "kind": "error", "message": "m" })
        );
    }

    #[test]
    fn puts_the_state_and_the_ready_update_side_by_side() {
        let window = |state, update| {
            serde_json::to_value(WindowState { state, update }).expect("window state serializes")
        };
        assert_eq!(
            window(CompanionState::Unpaired, None),
            json!({ "kind": "unpaired", "update": null })
        );
        assert_eq!(
            window(
                CompanionState::Paired {
                    instance_name: "x".into(),
                    cloud_connected: false,
                },
                Some(ReadyUpdate {
                    version: "1.2.3".into()
                }),
            ),
            json!({
                "kind": "paired",
                "instanceName": "x",
                "cloudConnected": false,
                "update": { "version": "1.2.3" },
            })
        );
    }

    #[test]
    fn names_the_version_on_the_tray_item() {
        let update = ReadyUpdate {
            version: "1.2.3".into(),
        };
        assert_eq!(update.tray_label(), "Restart to update to 1.2.3");
    }
}
