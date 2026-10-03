//! The companion token: generated here, kept in the OS credential store, and
//! sent to Convex only as a hash until pairing is approved.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, OnceLock};

const SERVICE: &str = "tv.woofx3.companion";
const ACCOUNT: &str = "companion-token";

/// Marks the string as a woofx3 companion token, so one pasted somewhere it
/// should not be is recognizable to a person or a secret scanner. Must match
/// `COMPANION_TOKEN_PREFIX` in convex/lib/companionCodes.ts.
pub const TOKEN_PREFIX: &str = "wfxc_";

/// 32 random bytes from the OS RNG, base64url without padding, prefixed.
pub fn generate_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|err| anyhow!("the OS random number generator failed: {err}"))?;
    Ok(format!("{TOKEN_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)))
}

/// Lowercase hex SHA-256 of the whole token, which is all Convex stores.
/// Must match `hashCompanionToken` in convex/lib/companionCodes.ts.
pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The stored token, and whether the person at this PC has confirmed the
/// pairing it belongs to. An unconfirmed token is kept across a restart so
/// an approval made meanwhile can still be confirmed. `instance_name` is what
/// the window shows until Convex answers, so a restart while offline still
/// says what this PC is paired with.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StoredToken {
    pub token: String,
    pub confirmed: bool,
    #[serde(default)]
    pub instance_name: Option<String>,
}

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).context("could not open the credential store")
}

fn load_blocking() -> Result<Option<StoredToken>> {
    match entry()?.get_password() {
        Ok(raw) => {
            let stored: StoredToken = serde_json::from_str(&raw)
                .context("the stored companion credential is unreadable")?;
            Ok(Some(stored))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(anyhow::Error::new(err).context("could not read the credential store")),
    }
}

fn store_blocking(stored: &StoredToken) -> Result<()> {
    let raw = serde_json::to_string(stored)?;
    entry()?
        .set_password(&raw)
        .context("could not write to the credential store")
}

fn clear_blocking() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(anyhow::Error::new(err).context("could not clear the credential store")),
    }
}

/// Serializes credential store calls in the order they were asked for. The
/// guard moves into the blocking task, so a store still finishes before a
/// later clear runs even when the task that asked for the store is aborted
/// mid-await (cancelling a pairing does exactly that).
fn store_lock() -> Arc<tokio::sync::Mutex<()>> {
    static LOCK: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
    LOCK.get_or_init(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Credential stores can block (a locked keychain, Secret Service over
/// D-Bus), so every call runs on Tokio's blocking pool, never on the thread
/// that drives the window or on an async worker.
async fn off_thread<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    let guard = store_lock().lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let result = work();
        drop(guard);
        result
    })
    .await
    .map_err(|err| anyhow!("the credential store task failed: {err}"))?
}

pub async fn load() -> Result<Option<StoredToken>> {
    off_thread(load_blocking).await
}

pub async fn store(stored: StoredToken) -> Result<()> {
    off_thread(move || store_blocking(&stored)).await
}

pub async fn clear() -> Result<()> {
    off_thread(clear_blocking).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_prefixed_base64url_of_32_bytes() {
        let token = generate_token().expect("token");
        let body = token.strip_prefix(TOKEN_PREFIX).expect("prefix");
        assert_eq!(body.len(), 43);
        assert!(body
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(token, generate_token().expect("second token"));
    }

    #[test]
    fn hash_matches_the_convex_side() {
        // Same vector as convex/lib/companionCodes.test.ts.
        let token = format!("{TOKEN_PREFIX}{}", "A".repeat(43));
        assert_eq!(
            hash_token(&token),
            "7547593d4576d48baa7f1497270d794ccb7eb6d5524cb5346b4f57473e440775"
        );
    }
}
