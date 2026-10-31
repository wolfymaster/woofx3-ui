//! Which product the running app is. The companion and the desktop app are
//! built from one crate and may be installed side by side on one PC, so
//! everything a product keeps there is named after its own Tauri identifier.
//! Tauri already does that for its data, config and log directories; the
//! credential store follows the same identifier through
//! [`AppIdentity::credential_service`].

/// The running app's identifier and product name, as its Tauri config sets
/// them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppIdentity {
    identifier: String,
    product_name: String,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum IdentityError {
    #[error("the app identifier {0:?} is not a reverse-DNS name such as tv.woofx3.app")]
    IdentifierInvalid(String),
    #[error("the app has no product name")]
    ProductNameMissing,
}

impl AppIdentity {
    pub fn new(identifier: &str, product_name: &str) -> Result<Self, IdentityError> {
        if !is_reverse_dns(identifier) {
            return Err(IdentityError::IdentifierInvalid(identifier.to_string()));
        }
        let product_name = product_name.trim();
        if product_name.is_empty() {
            return Err(IdentityError::ProductNameMissing);
        }
        Ok(Self {
            identifier: identifier.to_string(),
            product_name: product_name.to_string(),
        })
    }

    pub fn identifier(&self) -> &str {
        &self.identifier
    }

    /// The name people see: in message boxes, the update banner and the
    /// installer.
    pub fn product_name(&self) -> &str {
        &self.product_name
    }

    /// The service the OS credential store files this app's secrets under.
    /// It is the identifier itself, which keeps the companion reading the
    /// entries its existing installs wrote under `tv.woofx3.companion`.
    pub fn credential_service(&self) -> &str {
        &self.identifier
    }

    /// The title of the message box shown when the app cannot start.
    pub fn startup_failure_title(&self) -> String {
        format!("{} could not start", self.product_name)
    }
}

/// At least two dot-separated labels of ASCII letters, digits and hyphens,
/// none empty or starting or ending with a hyphen.
fn is_reverse_dns(identifier: &str) -> bool {
    let labels: Vec<&str> = identifier.split('.').collect();
    labels.len() >= 2
        && labels.iter().all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_companion_keeps_its_credential_service() {
        let companion = AppIdentity::new("tv.woofx3.companion", "woofx3 companion").expect("valid");
        assert_eq!(companion.credential_service(), "tv.woofx3.companion");
        assert_eq!(companion.product_name(), "woofx3 companion");
        assert_eq!(
            companion.startup_failure_title(),
            "woofx3 companion could not start"
        );
    }

    #[test]
    fn test_identity_desktop_app_has_a_credential_service_of_its_own() {
        let companion = AppIdentity::new("tv.woofx3.companion", "woofx3 companion").expect("valid");
        let desktop = AppIdentity::new("tv.woofx3.app", "woofx3").expect("valid");
        assert_eq!(desktop.credential_service(), "tv.woofx3.app");
        assert_ne!(desktop.credential_service(), companion.credential_service());
        assert_eq!(desktop.startup_failure_title(), "woofx3 could not start");
    }

    #[test]
    fn test_identity_rejects_identifiers_that_are_not_reverse_dns() {
        for identifier in [
            "",
            "woofx3",
            "tv..app",
            ".tv.woofx3",
            "tv.woofx3.",
            "tv.woofx3 app",
            "tv.-woofx3.app",
            "tv.woofx3-.app",
            "tv/woofx3.app",
        ] {
            assert_eq!(
                AppIdentity::new(identifier, "woofx3"),
                Err(IdentityError::IdentifierInvalid(identifier.to_string())),
                "{identifier:?}"
            );
        }
    }

    #[test]
    fn test_identity_rejects_a_blank_product_name() {
        for product_name in ["", "  "] {
            assert_eq!(
                AppIdentity::new("tv.woofx3.app", product_name),
                Err(IdentityError::ProductNameMissing)
            );
        }
    }

    #[test]
    fn test_identity_trims_the_product_name() {
        let identity = AppIdentity::new("tv.woofx3.app", " woofx3 ").expect("valid");
        assert_eq!(identity.product_name(), "woofx3");
    }
}
