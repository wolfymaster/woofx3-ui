//! Self-update. The companion looks for a newer signed release in the
//! background, downloads it, and then waits: it installs only when the person
//! picks Restart to update, since restarting drops the companion's
//! connections in the middle of whatever they are doing.
//!
//! Where to look, the public key and `requireSignedVersion` are in
//! tauri.conf.json under `plugins.updater`. The plugin verifies the signature
//! as part of the download, so a downloaded update is always a verified one.
//!
//! A failed check or download is logged and tried again after a capped,
//! jittered backoff, so a PC that started offline checks soon after its
//! network comes up. This needs no Convex connection, which an unpaired
//! companion does not have. A failure never becomes
//! `CompanionState::Error`: that state is about pairing, and an update that
//! cannot be fetched leaves the companion working as it was.

use std::sync::Arc;
use std::time::Duration;

use tauri_plugin_updater::{Update, UpdaterExt};
use woofx3_companion_core::backoff::Backoff;

use crate::Companion;

/// Startup is busy resuming the paired session, so the first check waits.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// The ceiling of the wait after the first failed check; jitter puts the
/// wait between half of it and all of it. It doubles with each failure in a
/// row, up to [`CHECK_INTERVAL`], and stays there.
const RETRY_INITIAL: Duration = Duration::from_secs(60);
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

/// When the next check runs: [`CHECK_INTERVAL`] after a success, and after a
/// failure a backoff that grows from [`RETRY_INITIAL`] to [`CHECK_INTERVAL`].
struct CheckSchedule {
    backoff: Backoff,
    failures: u32,
}

impl CheckSchedule {
    fn new() -> Self {
        CheckSchedule {
            backoff: Backoff {
                initial: RETRY_INITIAL,
                max: CHECK_INTERVAL,
            },
            failures: 0,
        }
    }

    fn after_success(&mut self) -> Duration {
        self.failures = 0;
        CHECK_INTERVAL
    }

    /// `jitter` is in `[0, 1]`, as [`Backoff::delay_with_jitter`] takes it.
    fn after_failure(&mut self, jitter: f64) -> Duration {
        let delay = self.backoff.delay_with_jitter(self.failures, jitter);
        self.failures = self.failures.saturating_add(1);
        delay
    }
}

/// Checks now and then for as long as the companion runs.
pub async fn run(companion: Arc<Companion>) {
    // A debug build is someone's working copy; offering to replace it with a
    // release would only get in the way.
    if cfg!(debug_assertions) {
        return;
    }
    tokio::time::sleep(FIRST_CHECK_DELAY).await;
    let mut schedule = CheckSchedule::new();
    loop {
        let wait = match check_and_download(&companion).await {
            Ok(()) => schedule.after_success(),
            Err(err) => {
                let wait = schedule.after_failure(rand::random_range(0.0..=1.0));
                eprintln!(
                    "[companion] update check failed, trying again in {} s: {err}",
                    wait.as_secs()
                );
                wait
            }
        };
        tokio::time::sleep(wait).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_schedule_backs_off_to_the_interval_and_resets_on_success() {
        let mut schedule = CheckSchedule::new();
        let failures: Vec<Duration> = (0..12).map(|_| schedule.after_failure(1.0)).collect();
        assert_eq!(failures[0], RETRY_INITIAL);
        assert_eq!(failures[1], RETRY_INITIAL * 2);
        assert!(failures.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(failures[11], CHECK_INTERVAL);
        assert_eq!(schedule.after_failure(0.0), CHECK_INTERVAL / 2);

        assert_eq!(schedule.after_success(), CHECK_INTERVAL);
        assert_eq!(schedule.after_failure(1.0), RETRY_INITIAL);
    }
}
