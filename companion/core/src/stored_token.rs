//! What the companion keeps in the OS credential store about its pairing:
//! the token, whether the pairing is confirmed, and the instance it is
//! paired with. The store outlives the app, so a record written by an older
//! version must stay readable: every field added since the first version
//! defaults when it is missing.

use serde::{Deserialize, Serialize};

use crate::window::LinkedInstance;

/// The stored token, and whether the person at this PC has confirmed the
/// pairing it belongs to. An unconfirmed token is kept across a restart so
/// an approval made meanwhile can still be confirmed. `instance_name` is what
/// the window shows until Convex answers, so a restart while offline still
/// says what this PC is paired with. `instance_id` lets the dashboard tell
/// whether this PC is already the companion of the instance it shows; a
/// record from before it was kept has none until Convex next names the
/// instance.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredToken {
    pub token: String,
    pub confirmed: bool,
    #[serde(default)]
    pub instance_name: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
}

impl StoredToken {
    /// A token whose pairing has not been approved or confirmed yet.
    pub fn unconfirmed(token: String) -> Self {
        StoredToken {
            token,
            confirmed: false,
            instance_name: None,
            instance_id: None,
        }
    }

    /// The record to keep once Convex reports the pairing confirmed for this
    /// instance, or `None` when the stored one already says exactly that, so
    /// an unchanged answer does not write to the credential store.
    pub fn confirmed_for(&self, instance_id: &str, instance_name: &str) -> Option<StoredToken> {
        let next = StoredToken {
            token: self.token.clone(),
            confirmed: true,
            instance_name: Some(instance_name.to_string()),
            instance_id: Some(instance_id.to_string()),
        };
        (next != *self).then_some(next)
    }

    /// The instance this token is the confirmed companion of, as the
    /// dashboard is told. An unconfirmed token is no one's companion yet.
    pub fn linked_instance(&self) -> Option<LinkedInstance> {
        if !self.confirmed {
            return None;
        }
        let instance_name = self.instance_name.clone()?;
        Some(LinkedInstance {
            instance_id: self.instance_id.clone(),
            instance_name,
        })
    }
}

/// Never prints the token.
impl std::fmt::Debug for StoredToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredToken")
            .field("token", &"<redacted>")
            .field("confirmed", &self.confirmed)
            .field("instance_name", &self.instance_name)
            .field("instance_id", &self.instance_id)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn confirmed(name: Option<&str>, id: Option<&str>) -> StoredToken {
        StoredToken {
            token: "wfxc_token".into(),
            confirmed: true,
            instance_name: name.map(str::to_string),
            instance_id: id.map(str::to_string),
        }
    }

    #[test]
    fn test_stored_token_reads_every_format_ever_written() {
        let cases = [
            (
                r#"{"token":"wfxc_token","confirmed":false}"#,
                StoredToken::unconfirmed("wfxc_token".into()),
            ),
            (
                r#"{"token":"wfxc_token","confirmed":true,"instance_name":"Main"}"#,
                confirmed(Some("Main"), None),
            ),
            (
                r#"{"token":"wfxc_token","confirmed":true,"instance_name":"Main","instance_id":"i1"}"#,
                confirmed(Some("Main"), Some("i1")),
            ),
        ];
        for (raw, expected) in cases {
            let read: StoredToken = serde_json::from_str(raw).expect(raw);
            assert_eq!(read, expected, "{raw}");
        }
    }

    #[test]
    fn test_stored_token_round_trips() {
        let stored = confirmed(Some("Main"), Some("i1"));
        let raw = serde_json::to_string(&stored).expect("serialize");
        assert_eq!(
            serde_json::from_str::<StoredToken>(&raw).expect("parse"),
            stored
        );
    }

    #[test]
    fn test_stored_token_refuses_a_record_without_a_token() {
        assert!(serde_json::from_str::<StoredToken>(r#"{"confirmed":true}"#).is_err());
    }

    #[test]
    fn test_stored_token_confirmed_for_writes_only_what_changed() {
        let cases = [
            (
                StoredToken::unconfirmed("wfxc_token".into()),
                Some(confirmed(Some("Main"), Some("i1"))),
            ),
            (
                confirmed(Some("Main"), None),
                Some(confirmed(Some("Main"), Some("i1"))),
            ),
            (
                confirmed(Some("Old name"), Some("i1")),
                Some(confirmed(Some("Main"), Some("i1"))),
            ),
            (confirmed(Some("Main"), Some("i1")), None),
        ];
        for (stored, expected) in cases {
            assert_eq!(stored.confirmed_for("i1", "Main"), expected, "{stored:?}");
        }
    }

    #[test]
    fn test_stored_token_linked_instance_needs_a_confirmed_pairing() {
        assert_eq!(
            StoredToken::unconfirmed("wfxc_token".into()).linked_instance(),
            None
        );
        assert_eq!(confirmed(None, None).linked_instance(), None);
        assert_eq!(
            confirmed(Some("Main"), None).linked_instance(),
            Some(LinkedInstance {
                instance_id: None,
                instance_name: "Main".into(),
            })
        );
        assert_eq!(
            confirmed(Some("Main"), Some("i1")).linked_instance(),
            Some(LinkedInstance {
                instance_id: Some("i1".into()),
                instance_name: "Main".into(),
            })
        );
    }

    #[test]
    fn test_stored_token_debug_output_redacts_the_token() {
        let printed = format!("{:?}", confirmed(Some("Main"), Some("i1")));
        assert!(!printed.contains("wfxc_token"));
        assert!(printed.contains("Main"));
    }
}
