//! Pairing through the browser, and the paired session that follows.
//!
//! The companion makes its own token and sends Convex only its hash. Approval
//! in the browser writes the companion row with that hash, so the companion
//! learns it was approved when `companions:self` with its token turns
//! non-null. It then asks the person at this PC to confirm who approved it,
//! because a code shown on stream could be approved by anyone who saw it.
//!
//! Whenever the companion gives up a token, it also tells Convex in the
//! background: `companionPairing:cancel` for the pending pairing and
//! `companions:unpair` for the token. Otherwise a pairing approved after the
//! companion forgot its token would leave a companion row nobody holds.
//!
//! The device code lives only in memory. The token is never logged and never
//! part of `CompanionState`.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::StreamExt;
use tauri::async_runtime::JoinHandle;
use tauri_plugin_opener::OpenerExt;

use crate::cloud::{
    decode, CompanionInfo, PairingStatus, PairingStatusReply, SelfUpdate, StartRequest,
};
use crate::credentials::{self, StoredToken};
use crate::integration_store::StoreIdentity;
use crate::integrations;
use crate::state::CompanionState;
use crate::Companion;

const COMPANION_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Must stay at or under MAX_DEVICE_NAME_LENGTH in convex/lib/companionCodes.ts.
const MAX_DEVICE_NAME_CHARS: usize = 64;

/// Convex counts a companion offline after three missed beats.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

/// How long a resumed session waits for Convex before saying it is offline,
/// so a normal start does not flash the offline screen.
const OFFLINE_GRACE: Duration = Duration::from_secs(3);

const EXPIRED_MESSAGE: &str = "The pairing code expired. Pair again.";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn device_name() -> String {
    let name = hostname::get()
        .map(|raw| raw.to_string_lossy().trim().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return "Unknown computer".to_string();
    }
    name.chars().take(MAX_DEVICE_NAME_CHARS).collect()
}

/// Tells Convex, in the background, that this companion gave up a pairing
/// and a token. Both calls are idempotent and either may be absent.
fn release_on_server(companion: &Companion, token: Option<String>, device_code: Option<String>) {
    if token.is_none() && device_code.is_none() {
        return;
    }
    let cloud = companion.cloud.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(device_code) = device_code {
            if let Err(err) = cloud.cancel_pairing(&device_code).await {
                eprintln!("[companion] pairing cancel did not reach woofx3: {err:#}");
            }
        }
        if let Some(token) = token {
            if let Err(err) = cloud.unpair(&token).await {
                eprintln!("[companion] unpair did not reach woofx3: {err:#}");
            }
        }
    });
}

/// Forgets the local token first, so a slow or offline Convex can never keep
/// it, then releases it on the server in the background. The endpoints this
/// companion served go with it, so a later pairing starts with nothing
/// enabled.
pub async fn forget_and_unpair(
    companion: &Arc<Companion>,
    token: Option<String>,
    device_code: Option<String>,
) {
    if let Err(err) = credentials::clear().await {
        eprintln!("[companion] could not clear the stored token: {err:#}");
    }
    companion.integrations.forget().await;
    companion.set_state(CompanionState::Unpaired);
    release_on_server(companion, token, device_code);
}

/// Ends a pairing attempt that cannot complete, as `forget_and_unpair` does,
/// but leaves the window showing why.
async fn fail(
    companion: &Arc<Companion>,
    token: Option<String>,
    device_code: Option<String>,
    message: impl Into<String>,
) {
    if let Err(err) = credentials::clear().await {
        eprintln!("[companion] could not clear the pairing token: {err:#}");
    }
    companion.set_state(CompanionState::Error {
        message: message.into(),
    });
    release_on_server(companion, token, device_code);
}

/// The whole device flow, from asking for a code to the paired session.
/// The caller has already claimed the start (`Companion::try_begin_start`).
pub async fn pair(companion: Arc<Companion>) {
    let start_claim = StartClaim(Arc::clone(&companion));

    // A token left over from an earlier pairing is given up before a new one
    // replaces it, so its row (if any) does not linger.
    match credentials::load().await {
        Ok(Some(previous)) => release_on_server(&companion, Some(previous.token), None),
        Ok(None) => {}
        Err(err) => eprintln!("[companion] could not read the previous token: {err:#}"),
    }

    let token = match credentials::generate_token() {
        Ok(token) => token,
        Err(err) => {
            fail(&companion, None, None, format!("{err:#}")).await;
            return;
        }
    };
    let stored = StoredToken {
        token: token.clone(),
        confirmed: false,
        instance_name: None,
    };
    if let Err(err) = credentials::store(stored).await {
        fail(&companion, None, None, format!("{err:#}")).await;
        return;
    }

    let device_name = device_name();
    let token_hash = credentials::hash_token(&token);
    let request = StartRequest {
        device_name: &device_name,
        companion_version: COMPANION_VERSION,
        installation_id: &companion.installation_id,
        token_hash: &token_hash,
    };
    let start = match companion.cloud.start_pairing(&request).await {
        Ok(start) => start,
        Err(err) => {
            fail(
                &companion,
                Some(token),
                None,
                format!("Could not start pairing: {err:#}"),
            )
            .await;
            return;
        }
    };

    // A duration, not Convex's timestamp, so a skewed clock on this PC does
    // not change how long the code is good for.
    let wait = Duration::from_millis(start.expires_in_ms.max(0.0) as u64);
    companion.set_device_code(Some(start.device_code.clone()));
    companion.set_verification_url(Some(start.verification_url.clone()));
    companion.set_state(CompanionState::Pairing {
        user_code: start.user_code.clone(),
        verification_url: start.verification_url.clone(),
        expires_at: now_ms() + wait.as_millis() as u64,
    });
    drop(start_claim);
    open_verification_url(&companion);

    let approved = wait_for_approval(&companion, &start.device_code, &token, wait).await;
    companion.set_device_code(None);
    companion.set_verification_url(None);
    if approved {
        run_session(companion, token, false, None).await;
    }
}

/// Releases the start claim when the start phase ends, however it ends: an
/// aborted task drops it too.
struct StartClaim(Arc<Companion>);

impl Drop for StartClaim {
    fn drop(&mut self) {
        self.0.end_start();
    }
}

/// True once `companions:self` answers for the token. On a decline or expiry
/// it ends the attempt itself and returns false.
async fn wait_for_approval(
    companion: &Arc<Companion>,
    device_code: &str,
    token: &str,
    wait: Duration,
) -> bool {
    let give_up = |message: String| {
        fail(
            companion,
            Some(token.to_string()),
            Some(device_code.to_string()),
            message,
        )
    };
    let mut status = match companion.cloud.watch_pairing_status(device_code).await {
        Ok(subscription) => subscription,
        Err(err) => {
            give_up(format!("Lost the connection to woofx3: {err:#}")).await;
            return false;
        }
    };
    let mut approval = match companion.cloud.watch_self(token).await {
        Ok(subscription) => subscription,
        Err(err) => {
            give_up(format!("Lost the connection to woofx3: {err:#}")).await;
            return false;
        }
    };
    let deadline = tokio::time::sleep(wait);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            _ = &mut deadline => {
                give_up(EXPIRED_MESSAGE.to_string()).await;
                return false;
            }
            Some(result) = status.next() => {
                match decode::<PairingStatusReply>(result).map(|reply| reply.status) {
                    Ok(PairingStatus::Denied) => {
                        give_up("Pairing was declined in the browser.".to_string()).await;
                        return false;
                    }
                    Ok(PairingStatus::Cancelled | PairingStatus::Unknown) => {
                        give_up(EXPIRED_MESSAGE.to_string()).await;
                        return false;
                    }
                    Ok(PairingStatus::Pending | PairingStatus::Approved) => {}
                    Err(err) => eprintln!("[companion] pairing status unavailable: {err:#}"),
                }
            }
            Some(result) = approval.next() => {
                match SelfUpdate::from_result(result) {
                    SelfUpdate::Paired(_) => return true,
                    SelfUpdate::Unpaired => {}
                    SelfUpdate::Failed(err) => eprintln!("[companion] approval check unavailable: {err:#}"),
                }
            }
        }
    }
}

/// Aborts the task it holds when dropped, so a task started by the paired
/// session ends with it, including when the session itself is aborted.
struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

fn start_integrations(
    companion: &Arc<Companion>,
    token: &str,
    info: &CompanionInfo,
) -> AbortOnDrop {
    let identity = StoreIdentity {
        companion_id: info.companion_id.clone(),
        instance_id: info.instance_id.clone(),
    };
    AbortOnDrop(tauri::async_runtime::spawn(integrations::run(
        Arc::clone(companion),
        token.to_string(),
        identity,
    )))
}

/// Follows `companions:self` for as long as the token is paired, and sends the
/// heartbeat once the pairing is confirmed. Convex's `confirmed` wins over the
/// local flag, so a confirmation that reached the server survives a crash
/// before the local store was updated. A null result means the companion was
/// revoked, rejected, or never approved: the token is given up. A query error
/// is not a revocation and changes nothing.
///
/// Integrations run alongside from the first answer that shows the pairing
/// confirmed until the session ends. They wait for that answer, not the local
/// flag, because their store is stamped with the companion and instance ids
/// it carries.
pub async fn run_session(
    companion: Arc<Companion>,
    token: String,
    local_confirmed: bool,
    known_name: Option<String>,
) {
    let mut connection = companion.cloud.connection();
    let mut confirmed = local_confirmed;
    let mut instance_name = known_name;
    let mut decided = false;
    let mut integrations: Option<AbortOnDrop> = None;
    if let (true, Some(name)) = (confirmed, &instance_name) {
        decided = true;
        companion.set_state(CompanionState::Paired {
            instance_name: name.clone(),
            cloud_connected: *connection.borrow(),
        });
    }

    let mut updates = match companion.cloud.watch_self(&token).await {
        Ok(subscription) => subscription,
        Err(err) => {
            companion.set_state(CompanionState::Error {
                message: format!("Lost the connection to woofx3: {err:#}"),
            });
            return;
        }
    };
    let offline_after = tokio::time::sleep(OFFLINE_GRACE);
    tokio::pin!(offline_after);
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = &mut offline_after, if !decided => {
                decided = true;
                companion.set_state(CompanionState::Offline);
            }
            update = updates.next() => {
                let Some(result) = update else {
                    return;
                };
                match SelfUpdate::from_result(result) {
                    SelfUpdate::Paired(info) => {
                        decided = true;
                        let newly_confirmed = info.confirmed && !confirmed;
                        let renamed = instance_name.as_deref() != Some(info.instance_name.as_str());
                        confirmed = confirmed || info.confirmed;
                        instance_name = Some(info.instance_name.clone());
                        if confirmed {
                            if newly_confirmed || renamed {
                                remember(&token, &info.instance_name).await;
                            }
                                                        if integrations.is_none() {
                                integrations = Some(start_integrations(&companion, &token, &info));
                            }
                            companion.set_state(CompanionState::Paired {
                                instance_name: info.instance_name,
                                cloud_connected: *connection.borrow(),
                            });
                        } else {
                            companion.set_state(CompanionState::ConfirmPairing {
                                instance_name: info.instance_name,
                                approved_by: info.approved_by_name,
                            });
                            companion.show_window();
                        }
                    }
                    SelfUpdate::Unpaired => {
                        drop(integrations.take());
                        forget_and_unpair(&companion, Some(token), None).await;
                        return;
                    }
                    SelfUpdate::Failed(err) => eprintln!("[companion] pairing check unavailable: {err:#}"),
                }
            }
            changed = connection.changed() => {
                if changed.is_err() {
                    return;
                }
                if let (true, Some(name)) = (confirmed, &instance_name) {
                    companion.set_state(CompanionState::Paired {
                        instance_name: name.clone(),
                        cloud_connected: *connection.borrow(),
                    });
                }
            }
            _ = heartbeat.tick(), if confirmed => {
                match companion.cloud.heartbeat(&token, COMPANION_VERSION).await {
                    Ok(beat) if !beat.paired => {
                        drop(integrations.take());
                        forget_and_unpair(&companion, Some(token), None).await;
                        return;
                    }
                    Ok(_) => {}
                    Err(err) => eprintln!("[companion] heartbeat failed: {err:#}"),
                }
            }
        }
    }
}

/// Stores the token as confirmed with the instance's current name, for the
/// window after a restart.
async fn remember(token: &str, instance_name: &str) {
    let stored = StoredToken {
        token: token.to_string(),
        confirmed: true,
        instance_name: Some(instance_name.to_string()),
    };
    if let Err(err) = credentials::store(stored).await {
        eprintln!("[companion] could not update the stored token: {err:#}");
    }
}

/// The person at this PC accepts who approved the pairing. Convex records it
/// first, so the confirmation is not lost if this PC crashes before the
/// local store is written.
pub async fn confirm(companion: Arc<Companion>, instance_name: String) -> Result<(), String> {
    let stored = credentials::load()
        .await
        .map_err(|err| format!("{err:#}"))?
        .ok_or_else(|| "The pairing token is missing. Pair again.".to_string())?;
    let reply = companion
        .cloud
        .confirm(&stored.token)
        .await
        .map_err(|err| format!("Could not confirm the pairing: {err:#}"))?;
    if !reply.paired {
        forget_and_unpair(&companion, Some(stored.token), None).await;
        return Err("This pairing is no longer approved. Pair again.".to_string());
    }
    remember(&stored.token, &instance_name).await;
    let session = tauri::async_runtime::spawn(run_session(
        Arc::clone(&companion),
        stored.token,
        true,
        Some(instance_name),
    ));
    companion.replace_flow(Some(session));
    Ok(())
}

pub fn open_verification_url(companion: &Companion) {
    let Some(url) = companion.verification_url() else {
        return;
    };
    if let Err(err) = companion.app.opener().open_url(url, None::<&str>) {
        eprintln!("[companion] could not open the browser: {err}");
    }
}
