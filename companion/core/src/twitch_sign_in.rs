//! The address the desktop app opens in the system browser to sign in to
//! woofx3 with Twitch. The dashboard asks for it with only the hash of a
//! nonce it keeps, and the address is built here from the Convex deployment
//! compiled into the app, so the dashboard cannot have the host open any
//! other page.

/// Convex's route that starts a Twitch sign-in. Must match the
/// `/api/auth/twitch/start` route in convex/http.ts.
const START_PATH: &str = "/api/auth/twitch/start";

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum TwitchSignInError {
    #[error("the Convex site URL {0:?} is not an http or https URL")]
    SiteUrlInvalid(String),
    /// The value is left out: one sent by mistake could be the raw nonce.
    #[error("the sign-in nonce hash is not 64 lowercase hex digits")]
    NonceHashInvalid,
}

/// The deployment's HTTP origin: the one configured when there is one, else
/// the deployment URL with its `.convex.cloud` host turned into
/// `.convex.site`. Must match `convexSiteUrl` in
/// client/src/lib/convexSiteUrl.ts, which the dashboard builds its own
/// Convex site URLs with from the same variables.
pub fn convex_site_url(convex_url: &str, configured_site_url: Option<&str>) -> String {
    if let Some(configured) = configured_site_url
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        return configured.to_string();
    }
    match convex_url.strip_suffix(".convex.cloud") {
        Some(deployment) => format!("{deployment}.convex.site"),
        None => convex_url.to_string(),
    }
}

/// Convex's start route for a desktop sign-in bound to `nonce_hash`. The
/// nonce itself never leaves the app this way: the system browser shows
/// this address and keeps it in its history.
pub fn twitch_sign_in_url(site_url: &str, nonce_hash: &str) -> Result<String, TwitchSignInError> {
    if !(site_url.starts_with("https://") || site_url.starts_with("http://")) {
        return Err(TwitchSignInError::SiteUrlInvalid(site_url.to_string()));
    }
    if !is_nonce_hash(nonce_hash) {
        return Err(TwitchSignInError::NonceHashInvalid);
    }
    let origin = site_url.trim_end_matches('/');
    Ok(format!(
        "{origin}{START_PATH}?client=desktop&nonce_hash={nonce_hash}"
    ))
}

/// Lowercase hex SHA-256, the only form of the nonce Convex accepts here.
fn is_nonce_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn test_convex_site_url_derives_or_takes_the_configured_origin() {
        let cases = [
            (
                "https://happy-otter-123.convex.cloud",
                None,
                "https://happy-otter-123.convex.site",
            ),
            (
                "https://happy-otter-123.eu-west-1.convex.cloud",
                None,
                "https://happy-otter-123.eu-west-1.convex.site",
            ),
            (
                "https://happy-otter-123.convex.cloud",
                Some("https://api.woofx3.tv"),
                "https://api.woofx3.tv",
            ),
            (
                "https://happy-otter-123.convex.cloud",
                Some("  "),
                "https://happy-otter-123.convex.site",
            ),
            ("http://127.0.0.1:3210", None, "http://127.0.0.1:3210"),
        ];
        for (convex_url, configured, expected) in cases {
            assert_eq!(
                convex_site_url(convex_url, configured),
                expected,
                "{convex_url} {configured:?}"
            );
        }
    }

    #[test]
    fn test_twitch_sign_in_url_names_only_the_desktop_client_and_the_hash() {
        assert_eq!(
            twitch_sign_in_url("https://happy-otter-123.convex.site/", HASH),
            Ok(format!(
                "https://happy-otter-123.convex.site/api/auth/twitch/start?client=desktop&nonce_hash={HASH}"
            ))
        );
    }

    #[test]
    fn test_twitch_sign_in_url_refuses_what_is_not_a_nonce_hash() {
        let not_hashes = [
            String::new(),
            HASH[..63].to_string(),
            format!("{HASH}0"),
            HASH.to_uppercase(),
            format!("{}&redirect_to=x", &HASH[..50]),
            // A raw nonce: base64url, 43 characters.
            "Qm9yaW5nIG5vbmNlIHRoYXQgaXMgNDMgY2hhcmFjdGU".to_string(),
        ];
        for value in not_hashes {
            assert_eq!(
                twitch_sign_in_url("https://happy-otter-123.convex.site", &value),
                Err(TwitchSignInError::NonceHashInvalid),
                "{value}"
            );
        }
    }

    #[test]
    fn test_twitch_sign_in_url_refuses_a_site_url_that_is_not_http() {
        assert!(matches!(
            twitch_sign_in_url("javascript:alert(1)", HASH),
            Err(TwitchSignInError::SiteUrlInvalid(_))
        ));
    }
}
