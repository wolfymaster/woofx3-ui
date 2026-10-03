use serde::Serialize;

/// What the window renders. Serialized with `kind` as the tag; must match
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
}
