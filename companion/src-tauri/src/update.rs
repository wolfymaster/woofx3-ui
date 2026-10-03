//! Self-update. The companion looks for a newer signed release in the
//! background, downloads it, and then waits: it installs only when the person
//! picks Restart to update, since restarting drops the companion's
//! connections in the middle of whatever they are doing.
//!
//! Where to look, the public key and `requireSignedVersion` are in
//! tauri.conf.json under `plugins.updater`. The plugin verifies the signature
//! as part of the download, so a downloaded update is always a verified one.
//!
//! A failed check or download is logged and tried again at the next interval.
//! It never becomes `CompanionState::Error`: that state is about pairing, and
//! an update that cannot be fetched leaves the companion working as it was.

use std::sync::Arc;
use std::time::Duration;

use tauri_plugin_updater::{Update, UpdaterExt};

use crate::Companion;

/// Startup is busy resuming the paired session, so the first check waits.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// The plugin sets no timeout of its own, so a stalled connection would
/// stop every later check. Generous, since it also covers the download.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// A release that passed signature verification, held in memory until it is
/// installed.
pub struct Downloaded {
    update: Update,
    bytes: Vec<u8>,
}

impl Downloaded {
    pub fn version(&self) -> &str {
        &self.update.version
    }
}

/// Checks now and then for as long as the companion runs. Checks wait for the
/// Convex connection, the companion's only sign of network access, so an
/// offline PC does not burn its attempts.
pub async fn run(companion: Arc<Companion>) {
    // A debug build is someone's working copy; offering to replace it with a
    // release would only get in the way.
    if cfg!(debug_assertions) {
        return;
    }
    let mut connection = companion.cloud.connection();
    tokio::time::sleep(FIRST_CHECK_DELAY).await;
    loop {
        if connection.wait_for(|connected| *connected).await.is_err() {
            eprintln!("[companion] the Convex connection is gone; no more update checks");
            return;
        }
        if let Err(err) = check_and_download(&companion).await {
            eprintln!("[companion] update check failed, trying again later: {err}");
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

async fn check_and_download(companion: &Companion) -> tauri_plugin_updater::Result<()> {
    let updater = companion
        .app
        .updater_builder()
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let Some(update) = updater.check().await? else {
        return Ok(());
    };
    let already_ready = companion
        .ready_update()
        .is_some_and(|ready| ready.version() == update.version);
    if already_ready {
        return Ok(());
    }
    let bytes = update.download(|_, _| {}, || {}).await?;
    eprintln!("[companion] update {} downloaded", update.version);
    companion.set_ready_update(Downloaded { update, bytes });
    Ok(())
}

/// Installs the ready update and restarts into it. On Windows the plugin
/// starts the installer and exits the process itself; the installer starts
/// the new version.
pub fn install(companion: &Companion) -> Result<(), String> {
    let Some(ready) = companion.ready_update() else {
        return Err("No update is ready to install.".to_string());
    };
    ready
        .update
        .install(&ready.bytes)
        .map_err(|err| format!("Could not install update {}: {err}", ready.version()))?;
    companion.app.restart()
}
