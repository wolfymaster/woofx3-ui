//! What the companion keeps in the OS credential store: the companion token,
//! generated here and sent to Convex only as a hash until pairing is
//! approved, and in local mode the client id and secret the local engine
//! issued to this host. Entries are filed under the running app's credential
//! service, so the companion and the desktop app never read each other's.

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures::future::BoxFuture;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, OnceLock};
use woofx3_companion_core::host::{ClientCredentials, CredentialStore};
use woofx3_companion_core::AppIdentity;
pub use woofx3_companion_core::StoredToken;

const TOKEN_ACCOUNT: &str = "companion-token";
const ENGINE_CLIENT_ACCOUNT: &str = "local-engine-client";

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

fn entry(service: &str, account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(service, account).context("could not open the credential store")
}

/// The JSON value stored under `account`; `label` names it in errors.
fn load_blocking<T: DeserializeOwned>(
    service: &str,
    account: &str,
    label: &str,
) -> Result<Option<T>> {
    match entry(service, account)?.get_password() {
        Ok(raw) => {
            let stored: T = serde_json::from_str(&raw)
                .with_context(|| format!("the stored {label} is unreadable"))?;
            Ok(Some(stored))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(anyhow::Error::new(err).context("could not read the credential store")),
    }
}

fn store_blocking<T: Serialize>(service: &str, account: &str, stored: &T) -> Result<()> {
    let raw = serde_json::to_string(stored)?;
    entry(service, account)?
        .set_password(&raw)
        .context("could not write to the credential store")
}

fn clear_blocking(service: &str, account: &str) -> Result<()> {
    match entry(service, account)?.delete_credential() {
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

/// The running app's entries in the OS credential store.
#[derive(Clone, Debug)]
pub struct Credentials {
    service: String,
}

impl Credentials {
    pub fn new(identity: &AppIdentity) -> Self {
        Self {
            service: identity.credential_service().to_string(),
        }
    }

    pub async fn load(&self) -> Result<Option<StoredToken>> {
        let service = self.service.clone();
        off_thread(move || load_blocking(&service, TOKEN_ACCOUNT, "companion credential")).await
    }

    pub async fn store(&self, stored: StoredToken) -> Result<()> {
        let service = self.service.clone();
        off_thread(move || store_blocking(&service, TOKEN_ACCOUNT, &stored)).await
    }

    pub async fn clear(&self) -> Result<()> {
        let service = self.service.clone();
        off_thread(move || clear_blocking(&service, TOKEN_ACCOUNT)).await
    }

    pub fn engine_client_store(&self) -> EngineClientStore {
        EngineClientStore {
            service: self.service.clone(),
        }
    }
}

/// The local engine's client credentials, in the credential store next to
/// the companion token.
pub struct EngineClientStore {
    service: String,
}

impl CredentialStore for EngineClientStore {
    fn load(&self) -> BoxFuture<'_, Result<Option<ClientCredentials>>> {
        let service = self.service.clone();
        Box::pin(off_thread(move || {
            load_blocking(&service, ENGINE_CLIENT_ACCOUNT, "engine client credential")
        }))
    }

    fn store(&self, credentials: ClientCredentials) -> BoxFuture<'_, Result<()>> {
        let service = self.service.clone();
        Box::pin(off_thread(move || {
            store_blocking(&service, ENGINE_CLIENT_ACCOUNT, &credentials)
        }))
    }
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
