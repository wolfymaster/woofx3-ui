//! The paired session: this computer linked to an instance as its companion.
//!
//! The signed-in dashboard links it (`finish_app_link`): the host makes its
//! own token and Convex only ever sees its hash. The session then follows
//! `companions:self` with that token, sends the heartbeat, and runs the
//! local integrations.
//!
//! Whenever this computer gives up a token, it also tells Convex in the
//! background with `companions:unpair`, so no companion row is left that
//! nobody holds. The token is never logged and never part of
//! `CompanionState`.

use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use tauri::async_runtime::JoinHandle;

use crate::cloud::{CloudSession, CompanionInfo, SelfUpdate};
use crate::credentials::StoredToken;
use crate::integration_store::StoreIdentity;
use crate::integrations;
use crate::Companion;
use woofx3_companion_core::window::{CompanionState, FinishAppLinkArgs};

/// Must stay at or under MAX_DEVICE_NAME_LENGTH in convex/lib/companionCodes.ts.
const MAX_DEVICE_NAME_CHARS: usize = 64;

/// Convex counts a companion offline after three missed beats.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

/// How long a resumed session waits for Convex before saying it is offline,
/// so a normal start does not flash the offline screen.
const OFFLINE_GRACE: Duration = Duration::from_secs(3);

pub(crate) fn device_name() -> String {
    let name = hostname::get()
        .map(|raw| raw.to_string_lossy().trim().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return "Unknown computer".to_string();
    }
    name.chars().take(MAX_DEVICE_NAME_CHARS).collect()
}

/// Tells Convex, in the background, that this computer gave up its token.
/// The call is idempotent. A token means a link existed, so this opens the
/// Convex connection if it is not open yet. The background call holds its
/// own handle on the connection, so going dormant right after does not cut
/// it off.
async fn release_on_server(companion: &Arc<Companion>, token: Option<String>) {
    let Some(token) = token else {
        return;
    };
    let cloud = match companion.cloud_link.connect().await {
        Ok(cloud) => cloud,
        Err(err) => {
            eprintln!("[companion] could not open the connection to release a link: {err:#}");
            return;
        }
    };
    tauri::async_runtime::spawn(async move {
        if let Err(err) = cloud.unpair(&token).await {
            eprintln!("[companion] unpair did not reach woofx3: {err:#}");
        }
    });
}

/// Forgets the local token first, so a slow or offline Convex can never keep
/// it, then releases it on the server in the background. The endpoints this
/// computer served go with it, so a later link starts with nothing enabled.
/// An unlinked computer keeps no Convex connection, so the link goes dormant.
pub async fn forget_and_unpair(companion: &Arc<Companion>, token: Option<String>) {
    if let Err(err) = companion.credentials.clear().await {
        eprintln!("[companion] could not clear the stored token: {err:#}");
    }
    companion.integrations.forget().await;
    release_on_server(companion, token).await;
    companion.cloud_link.disconnect().await;
    companion.set_state(CompanionState::Unpaired);
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
    session: CloudSession,
    info: &CompanionInfo,
) -> AbortOnDrop {
    let identity = StoreIdentity {
        companion_id: info.companion_id.clone(),
        instance_id: info.instance_id.clone(),
    };
    AbortOnDrop(tauri::async_runtime::spawn(integrations::run(
        Arc::clone(companion),
        session,
        identity,
    )))
}

/// Follows `companions:self` for as long as the token is paired, and sends the
/// heartbeat. A null result means the companion was revoked: the token is
/// given up. A query error is not a revocation and changes nothing.
///
/// Integrations run alongside from the first answer until the session ends.
/// They wait for that answer because their store is stamped with the
/// companion and instance ids it carries.
///
/// A session needs Convex, so it opens the connection if it is not open yet.
/// `stored` is a confirmed token as the credential store holds it (the
/// caller gives up an unconfirmed one); the session keeps that record in step
/// with what Convex answers.
pub async fn run_session(companion: Arc<Companion>, mut stored: StoredToken) {
    let cloud = match companion.cloud_link.connect().await {
        Ok(cloud) => cloud,
        Err(err) => {
            companion.set_state(CompanionState::Error {
                message: format!("Could not open the connection to woofx3: {err:#}"),
            });
            return;
        }
    };
    let mut connection = cloud.connection();
    let token = stored.token.clone();
    let mut instance_name = stored.instance_name.clone();
    let mut decided = false;
    let mut integrations: Option<AbortOnDrop> = None;
    if let Some(name) = &instance_name {
        decided = true;
        companion.set_state(CompanionState::Paired {
            instance_name: name.clone(),
            cloud_connected: *connection.borrow(),
        });
    }

    let mut updates = match cloud.watch_self(&token).await {
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
                        instance_name = Some(info.instance_name.clone());
                        if let Some(next) = stored.confirmed_for(&info.instance_id, &info.instance_name) {
                            if remember(&companion, next.clone()).await {
                                stored = next;
                            }
                        }
                        if integrations.is_none() {
                            let session = CloudSession {
                                cloud: cloud.clone(),
                                token: token.clone(),
                            };
                            integrations = Some(start_integrations(&companion, session, &info));
                        }
                        companion.set_state(CompanionState::Paired {
                            instance_name: info.instance_name,
                            cloud_connected: *connection.borrow(),
                        });
                    }
                    SelfUpdate::Unpaired => {
                        drop(integrations.take());
                        forget_and_unpair(&companion, Some(token)).await;
                        return;
                    }
                    SelfUpdate::Failed(err) => eprintln!("[companion] pairing check unavailable: {err:#}"),
                }
            }
            changed = connection.changed() => {
                if changed.is_err() {
                    return;
                }
                if let Some(name) = &instance_name {
                    companion.set_state(CompanionState::Paired {
                        instance_name: name.clone(),
                        cloud_connected: *connection.borrow(),
                    });
                }
            }
            _ = heartbeat.tick() => {
                match cloud.heartbeat(&token, &companion.version).await {
                    Ok(beat) if !beat.paired => {
                        drop(integrations.take());
                        forget_and_unpair(&companion, Some(token)).await;
                        return;
                    }
                    Ok(_) => {}
                    Err(err) => eprintln!("[companion] heartbeat failed: {err:#}"),
                }
            }
        }
    }
}

/// Stores the token's record, for the dashboard after a restart. False when the credential store refused it.
async fn remember(companion: &Companion, stored: StoredToken) -> bool {
    match companion.credentials.store(stored).await {
        Ok(()) => true,
        Err(err) => {
            eprintln!("[companion] could not update the stored token: {err:#}");
            false
        }
    }
}

/// Makes the token `begin_app_link` handed out this computer's confirmed
/// pairing, once the signed-in dashboard has had Convex record it as the
/// instance's companion. Whoever is signed in to the dashboard on this PC
/// is the person at the PC, so no separate confirmation is asked for.
///
/// Any previous pairing is given up first, as unpairing does. The pending
/// token is kept until it is stored, so a failure here can be retried with
/// the same one.
pub async fn finish_app_link(
    companion: Arc<Companion>,
    link: FinishAppLinkArgs,
) -> Result<(), String> {
    let token = companion
        .pending_link()
        .ok_or_else(|| "No link with woofx3 is waiting to finish. Sign in again.".to_string())?;
    companion.stop_and_forget().await?;
    let stored = StoredToken {
        token,
        confirmed: true,
        instance_name: Some(link.instance_name),
        instance_id: Some(link.instance_id),
    };
    companion
        .credentials
        .store(stored.clone())
        .await
        .map_err(|err| format!("{err:#}"))?;
    companion.clear_pending_link(&stored.token);
    let session = tauri::async_runtime::spawn(run_session(Arc::clone(&companion), stored));
    companion.replace_flow(Some(session));
    Ok(())
}
