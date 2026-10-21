/// Checks the Convex deployment URL compiled into the companion. convex-rs
/// turns it into a WebSocket URL, which it can only do for an `http` or
/// `https` URL with a host, so anything else is refused when the companion is
/// built rather than when it first connects. Used by build.rs and tested in
/// lib.rs.
pub fn check_convex_url(raw: &str) -> Result<(), String> {
    if raw != raw.trim() {
        return Err(format!("{raw:?} has surrounding whitespace"));
    }
    let url = url::Url::parse(raw).map_err(|err| format!("{raw:?} is not a URL: {err}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("{raw:?} is not an http or https URL"));
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(format!("{raw:?} has no host"));
    }
    Ok(())
}
