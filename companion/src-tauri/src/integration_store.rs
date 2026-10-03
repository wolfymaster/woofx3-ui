//! The companion's own record of the local endpoints it serves:
//! `integrations.json` in the app data directory.
//!
//! This file is the only authority for what the bridge may dial. Convex gets a
//! copy of each address to show in the browser, but the companion never reads
//! one back, so a compromised Convex, engine or module cannot redirect it. An
//! address gets here only from discovery on this PC or from the streamer
//! confirming it in the companion window.
//!
//! The file is stamped with the companion and instance it was written for. A
//! session for any other pairing ignores it and starts empty, so endpoints
//! enabled for one instance are never served to another. Pairing the same
//! installation to the same instance again keeps it: approval updates that
//! installation's companion row in place, so its id is unchanged, and the
//! confirmed addresses, which exist only on this PC, survive the re-pair.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use woofx3_companion_core::{ConfirmedAddress, EndpointResolver};

use crate::lock;

const FILE_NAME: &str = "integrations.json";
const TEMP_FILE_NAME: &str = "integrations.json.tmp";

/// What the companion does for one endpoint.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEndpoint {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub address: Option<ConfirmedAddress>,
    /// The streamer agreed to send the password found on this PC to woofx3.
    #[serde(default)]
    pub share_password: bool,
    /// SHA-256 of the password last sent, so it is sent again only when it
    /// changes, without keeping the password itself.
    #[serde(default)]
    pub sent_password_sha256: Option<String>,
}

/// The pairing a store belongs to, from `companions:self`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreIdentity {
    pub companion_id: String,
    pub instance_id: String,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    #[serde(default)]
    companion_id: Option<String>,
    #[serde(default)]
    instance_id: Option<String>,
    #[serde(default)]
    endpoints: BTreeMap<String, StoredEndpoint>,
}

impl StoreFile {
    fn written_for(&self, identity: &StoreIdentity) -> bool {
        self.companion_id.as_deref() == Some(identity.companion_id.as_str())
            && self.instance_id.as_deref() == Some(identity.instance_id.as_str())
    }
}

/// The store's key for an endpoint: `<module id>/<endpoint id>`.
pub fn endpoint_key(module_id: &str, endpoint_id: &str) -> String {
    format!("{module_id}/{endpoint_id}")
}

struct Entries {
    /// The pairing this session serves; None until loaded for a paired
    /// session, and again once forgotten, so a write still in flight from an
    /// ended session cannot bring the file back.
    identity: Option<StoreIdentity>,
    endpoints: BTreeMap<String, StoredEndpoint>,
}

pub struct IntegrationStore {
    dir: PathBuf,
    entries: Mutex<Entries>,
    /// Keys of the bridgeable endpoints of modules installed on the instance,
    /// from the latest `forCompanion`. An endpoint whose module was
    /// uninstalled stops resolving as soon as Convex says so, whatever the
    /// file still holds.
    installed: Mutex<HashSet<String>>,
    /// Marked on every change that can alter what `resolve` answers, so the
    /// relay client closes streams that no longer resolve.
    changes: watch::Sender<()>,
    /// Orders file writes the way `credentials` orders keyring calls: the
    /// guard moves into the blocking task, so writes land in the order they
    /// were asked for even when the asking task is aborted.
    write_order: Arc<tokio::sync::Mutex<()>>,
}

impl IntegrationStore {
    pub fn new(dir: &Path) -> Self {
        IntegrationStore {
            dir: dir.to_path_buf(),
            entries: Mutex::new(Entries {
                identity: None,
                endpoints: BTreeMap::new(),
            }),
            installed: Mutex::new(HashSet::new()),
            changes: watch::channel(()).0,
            write_order: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    /// Reads the file for a paired session. A missing file, or one written
    /// for another companion or instance, is an empty store. An unreadable
    /// one is reported and replaced by an empty store, which dials nothing
    /// until the streamer enables an endpoint again.
    pub async fn load(&self, identity: StoreIdentity) -> Result<()> {
        let path = self.dir.join(FILE_NAME);
        let guard = Arc::clone(&self.write_order).lock_owned().await;
        let read = tokio::task::spawn_blocking(move || {
            let result = read_file(&path);
            drop(guard);
            result
        })
        .await
        .map_err(|err| anyhow!("the integrations file task failed: {err}"))?;
        let (endpoints, outcome) = match read {
            Ok(file) if file.written_for(&identity) => (file.endpoints, Ok(())),
            Ok(_) => (BTreeMap::new(), Ok(())),
            Err(err) => (BTreeMap::new(), Err(err)),
        };
        *lock(&self.entries) = Entries {
            identity: Some(identity),
            endpoints,
        };
        self.changes.send_replace(());
        outcome
    }

    pub fn get(&self, key: &str) -> Option<StoredEndpoint> {
        lock(&self.entries).endpoints.get(key).cloned()
    }

    pub fn all(&self) -> BTreeMap<String, StoredEndpoint> {
        lock(&self.entries).endpoints.clone()
    }

    /// Changes one entry and writes the file. Returns the entry as stored.
    pub async fn update(
        &self,
        key: &str,
        change: impl FnOnce(&mut StoredEndpoint),
    ) -> Result<StoredEndpoint> {
        let updated = {
            let mut entries = lock(&self.entries);
            if entries.identity.is_none() {
                return Err(anyhow!("This computer is not paired."));
            }
            let entry = entries.endpoints.entry(key.to_string()).or_default();
            change(entry);
            entry.clone()
        };
        self.changes.send_replace(());
        self.persist().await?;
        Ok(updated)
    }

    /// Drops every entry and deletes the file, for unpairing and for a new
    /// pairing.
    pub async fn forget(&self) -> Result<()> {
        {
            let mut entries = lock(&self.entries);
            entries.identity = None;
            entries.endpoints.clear();
        }
        lock(&self.installed).clear();
        self.changes.send_replace(());
        let path = self.dir.join(FILE_NAME);
        let guard = Arc::clone(&self.write_order).lock_owned().await;
        tokio::task::spawn_blocking(move || {
            let result =
                match std::fs::remove_file(&path) {
                    Ok(()) => Ok(()),
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(err) => Err(anyhow::Error::new(err)
                        .context(format!("could not delete {}", path.display()))),
                };
            drop(guard);
            result
        })
        .await
        .map_err(|err| anyhow!("the integrations file task failed: {err}"))?
    }

    pub fn set_installed(&self, keys: HashSet<String>) {
        let changed = {
            let mut installed = lock(&self.installed);
            let changed = *installed != keys;
            *installed = keys;
            changed
        };
        if changed {
            self.changes.send_replace(());
        }
    }

    /// True when at least one endpoint would resolve, which is when the relay
    /// connection is worth holding.
    pub fn has_dialable(&self) -> bool {
        let installed = lock(&self.installed).clone();
        lock(&self.entries)
            .endpoints
            .iter()
            .any(|(key, entry)| entry.enabled && entry.address.is_some() && installed.contains(key))
    }

    /// Writes what is in memory when the write's turn comes, so the last
    /// write always carries every change made before it.
    async fn persist(&self) -> Result<()> {
        let guard = Arc::clone(&self.write_order).lock_owned().await;
        let snapshot = {
            let entries = lock(&self.entries);
            let Some(identity) = entries.identity.clone() else {
                return Err(anyhow!("This computer is not paired."));
            };
            StoreFile {
                companion_id: Some(identity.companion_id),
                instance_id: Some(identity.instance_id),
                endpoints: entries.endpoints.clone(),
            }
        };
        let dir = self.dir.clone();
        tokio::task::spawn_blocking(move || {
            let result = write_file(&dir, &snapshot);
            drop(guard);
            result
        })
        .await
        .map_err(|err| anyhow!("the integrations file task failed: {err}"))?
    }
}

impl EndpointResolver for IntegrationStore {
    fn resolve(&self, module_id: &str, endpoint_id: &str) -> Option<ConfirmedAddress> {
        let key = endpoint_key(module_id, endpoint_id);
        if !lock(&self.installed).contains(&key) {
            return None;
        }
        let entries = lock(&self.entries);
        let entry = entries.endpoints.get(&key)?;
        if !entry.enabled {
            return None;
        }
        entry.address.clone()
    }

    fn changes(&self) -> watch::Receiver<()> {
        self.changes.subscribe()
    }
}

fn read_file(path: &Path) -> Result<StoreFile> {
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .with_context(|| format!("{} is unreadable; starting empty", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(StoreFile::default()),
        Err(err) => {
            Err(anyhow::Error::new(err).context(format!("could not read {}", path.display())))
        }
    }
}

/// Writes a temporary file and renames it over the real one, so a crash
/// mid-write leaves the previous file whole.
fn write_file(dir: &Path, file: &StoreFile) -> Result<()> {
    std::fs::create_dir_all(dir).with_context(|| format!("could not create {}", dir.display()))?;
    let temp = dir.join(TEMP_FILE_NAME);
    let json = serde_json::to_vec_pretty(file)?;
    std::fs::write(&temp, json).with_context(|| format!("could not write {}", temp.display()))?;
    let path = dir.join(FILE_NAME);
    std::fs::rename(&temp, &path).with_context(|| format!("could not replace {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("woofx3-companion-store-{}", uuid::Uuid::new_v4()))
    }

    fn identity(companion_id: &str, instance_id: &str) -> StoreIdentity {
        StoreIdentity {
            companion_id: companion_id.into(),
            instance_id: instance_id.into(),
        }
    }

    #[test]
    fn serializes_as_the_documented_file_shape() {
        let mut file = StoreFile {
            companion_id: Some("c1".into()),
            instance_id: Some("i1".into()),
            endpoints: BTreeMap::new(),
        };
        file.endpoints.insert(
            endpoint_key("woofx3_obs", "obs"),
            StoredEndpoint {
                enabled: true,
                address: Some(ConfirmedAddress::discovered_loopback(4455)),
                share_password: false,
                sent_password_sha256: None,
            },
        );
        assert_eq!(
            serde_json::to_value(&file).expect("serializes"),
            json!({
                "companionId": "c1",
                "instanceId": "i1",
                "endpoints": {
                    "woofx3_obs/obs": {
                        "enabled": true,
                        "address": { "host": "127.0.0.1", "port": 4455, "origin": "discovered" },
                        "sharePassword": false,
                        "sentPasswordSha256": null,
                    }
                }
            })
        );
    }

    #[test]
    fn an_address_that_fails_validation_makes_the_file_unreadable() {
        let raw = json!({
            "companionId": "c1",
            "instanceId": "i1",
            "endpoints": {
                "woofx3_obs/obs": {
                    "enabled": true,
                    "address": { "host": "ws://evil", "port": 80, "origin": "confirmed" },
                }
            }
        });
        assert!(serde_json::from_value::<StoreFile>(raw).is_err());
    }

    #[tokio::test]
    async fn resolves_only_enabled_endpoints_of_installed_modules() {
        let dir = temp_dir();
        let store = IntegrationStore::new(&dir);
        store.load(identity("c1", "i1")).await.expect("loads");
        let mut changes = store.changes();
        changes.borrow_and_update();
        let key = endpoint_key("woofx3_obs", "obs");
        store
            .update(&key, |entry| {
                entry.address = Some(ConfirmedAddress::discovered_loopback(4455));
            })
            .await
            .expect("stores");
        assert!(changes.has_changed().unwrap(), "an update is announced");
        changes.borrow_and_update();
        store.set_installed(HashSet::from([key.clone()]));
        assert!(
            changes.has_changed().unwrap(),
            "a new installed set is announced"
        );
        changes.borrow_and_update();
        store.set_installed(HashSet::from([key.clone()]));
        assert!(!changes.has_changed().unwrap(), "the same set is not");
        assert_eq!(store.resolve("woofx3_obs", "obs"), None, "not enabled");
        assert!(!store.has_dialable());

        store
            .update(&key, |entry| entry.enabled = true)
            .await
            .expect("stores");
        assert_eq!(
            store.resolve("woofx3_obs", "obs"),
            Some(ConfirmedAddress::discovered_loopback(4455))
        );
        assert!(store.has_dialable());
        assert_eq!(store.resolve("woofx3_obs", "other"), None);

        store.set_installed(HashSet::new());
        assert_eq!(store.resolve("woofx3_obs", "obs"), None, "uninstalled");
        assert!(!store.has_dialable());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn persists_atomically_and_forgets_everything() {
        let dir = temp_dir();
        let store = IntegrationStore::new(&dir);
        store.load(identity("c1", "i1")).await.expect("loads");
        let key = endpoint_key("woofx3_obs", "obs");
        store
            .update(&key, |entry| {
                entry.enabled = true;
                entry.address = Some(ConfirmedAddress::confirmed("10.0.0.2:4455").unwrap());
            })
            .await
            .expect("stores");
        assert!(!dir.join(TEMP_FILE_NAME).exists());

        let reloaded = IntegrationStore::new(&dir);
        reloaded.load(identity("c1", "i1")).await.expect("reloads");
        assert_eq!(reloaded.all(), store.all());

        store.forget().await.expect("forgets");
        assert!(store.all().is_empty());
        assert!(!dir.join(FILE_NAME).exists());
        assert!(
            store
                .update(&key, |entry| entry.enabled = true)
                .await
                .is_err(),
            "a forgotten store takes no writes until loaded again"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The store a re-pair finds: written by the previous session, then
    /// loaded by a new one.
    async fn written_then_reloaded(
        dir: &Path,
        written_for: StoreIdentity,
        loaded_for: StoreIdentity,
    ) -> IntegrationStore {
        let store = IntegrationStore::new(dir);
        store.load(written_for).await.expect("loads");
        store
            .update(&endpoint_key("woofx3_obs", "obs"), |entry| {
                entry.enabled = true;
                entry.address = Some(ConfirmedAddress::confirmed("192.168.1.20:4455").unwrap());
            })
            .await
            .expect("stores");
        let reloaded = IntegrationStore::new(dir);
        reloaded.load(loaded_for).await.expect("reloads");
        reloaded
    }

    #[tokio::test]
    async fn a_re_pair_to_the_same_instance_keeps_confirmed_addresses() {
        let dir = temp_dir();
        let reloaded =
            written_then_reloaded(&dir, identity("c1", "i1"), identity("c1", "i1")).await;
        let entry = reloaded
            .get(&endpoint_key("woofx3_obs", "obs"))
            .expect("kept");
        assert_eq!(
            entry.address,
            Some(ConfirmedAddress::confirmed("192.168.1.20:4455").unwrap())
        );
        assert!(entry.enabled);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_pairing_to_a_different_instance_starts_empty() {
        let dir = temp_dir();
        let reloaded =
            written_then_reloaded(&dir, identity("c1", "i1"), identity("c2", "i2")).await;
        assert!(reloaded.all().is_empty());
        // The next write replaces the old instance's file with this one's.
        reloaded
            .update(&endpoint_key("woofx3_obs", "obs"), |entry| {
                entry.share_password = true
            })
            .await
            .expect("stores");
        let again = IntegrationStore::new(&dir);
        again.load(identity("c1", "i1")).await.expect("loads");
        assert!(
            again.all().is_empty(),
            "the old instance's endpoints are gone"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn a_store_written_for_another_pairing_loads_empty() {
        let dir = temp_dir();
        let store = IntegrationStore::new(&dir);
        store.load(identity("c1", "i1")).await.expect("loads");
        let key = endpoint_key("woofx3_obs", "obs");
        store
            .update(&key, |entry| entry.enabled = true)
            .await
            .expect("stores");

        for other in [identity("c1", "i2"), identity("c2", "i1")] {
            let reloaded = IntegrationStore::new(&dir);
            reloaded.load(other).await.expect("loads");
            assert!(reloaded.all().is_empty());
        }

        std::fs::write(dir.join(FILE_NAME), r#"{ "endpoints": {} }"#).unwrap();
        let unstamped = IntegrationStore::new(&dir);
        unstamped.load(identity("c1", "i1")).await.expect("loads");
        assert!(unstamped.all().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn an_unreadable_file_loads_as_empty_and_says_so() {
        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE_NAME), "not json").unwrap();
        let store = IntegrationStore::new(&dir);
        assert!(store.load(identity("c1", "i1")).await.is_err());
        assert!(store.all().is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }
}
