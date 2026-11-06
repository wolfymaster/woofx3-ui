//! The pages the dashboard may have the host open in the system browser.
//! The dashboard shows links from places the app does not control (module
//! listings, chat, clips, a streamer's own page), so the host opens only
//! web pages: an `http` or `https` URL with a host. Anything else (`file:`,
//! `javascript:`, a custom scheme that would start another program) is
//! refused rather than handed to the operating system.

use reqwest::Url;

/// A page address is at most this long: browsers and servers reject far
/// shorter ones, so anything longer is not a link a person clicked.
const MAX_URL_LENGTH: usize = 8 * 1024;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ExternalUrlError {
    #[error("the address is longer than {MAX_URL_LENGTH} characters")]
    TooLong,
    #[error("{0:?} is not a valid address")]
    Invalid(String),
    #[error("only web pages open in the browser, not {0:?} addresses")]
    SchemeRefused(String),
    #[error("{0:?} names no host")]
    NoHost(String),
}

/// Parses `raw` as a web page the browser may open.
pub fn external_url(raw: &str) -> Result<Url, ExternalUrlError> {
    if raw.len() > MAX_URL_LENGTH {
        return Err(ExternalUrlError::TooLong);
    }
    let url = Url::parse(raw).map_err(|_| ExternalUrlError::Invalid(raw.to_string()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ExternalUrlError::SchemeRefused(url.scheme().to_string()));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(ExternalUrlError::NoHost(raw.to_string()));
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_external_url_accepts_web_pages() {
        for raw in [
            "https://www.twitch.tv/activate",
            "http://127.0.0.1:9101/overlay?key=abc",
            "https://clips.twitch.tv/SomeClip-abc_123",
        ] {
            assert_eq!(
                external_url(raw).map(|url| url.to_string()),
                Ok(Url::parse(raw).unwrap().to_string()),
                "{raw}"
            );
        }
    }

    #[test]
    fn test_external_url_refuses_other_schemes() {
        for (raw, scheme) in [
            ("file:///C:/Windows/System32/calc.exe", "file"),
            ("javascript:alert(1)", "javascript"),
            ("ms-settings:privacy", "ms-settings"),
            ("mailto:someone@example.com", "mailto"),
        ] {
            assert_eq!(
                external_url(raw),
                Err(ExternalUrlError::SchemeRefused(scheme.to_string())),
                "{raw}"
            );
        }
    }

    #[test]
    fn test_external_url_refuses_what_is_not_an_address() {
        assert!(matches!(
            external_url("/admin/integrations"),
            Err(ExternalUrlError::Invalid(_))
        ));
        assert!(matches!(
            external_url(""),
            Err(ExternalUrlError::Invalid(_))
        ));
    }

    #[test]
    fn test_external_url_refuses_overlong_addresses() {
        let raw = format!("https://example.com/{}", "a".repeat(MAX_URL_LENGTH));
        assert_eq!(external_url(&raw), Err(ExternalUrlError::TooLong));
    }
}
