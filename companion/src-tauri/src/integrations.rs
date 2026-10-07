//! Local integrations: the endpoints of modules installed on the instance
//! that this companion serves over the relay, generated from their `local[]`
//! entries rather than written per integration.
//!
//! [`run`] lives for one paired, confirmed session. It follows
//! `companionIntegrations:forCompanion`, holds the relay connection while at
//! least one enabled endpoint can be dialled, runs discovery every minute and
//! when the window gains focus, and fills in the module settings discovery
//! found. The window's commands change the store and wake it.
//!
//! What the bridge dials comes only from [`IntegrationStore`]: an address
//! discovered on this PC or confirmed by the streamer in this window. Convex
//! gets a copy of each address for display and never hands one back.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::future::BoxFuture;
use futures::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Notify};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use woofx3_companion_core::backoff::Backoff;
use woofx3_companion_core::obs_config::{self, ObsDiscovery};
use woofx3_companion_core::{
    probe, run_relay, AddressOrigin, ConfirmedAddress, CredentialSource, EndpointResolver,
    ProbeOutcome, RelayGrant, RelayStatus, Stopped,
};

use crate::cloud::{
    is_integrations_unavailable, Cloud, DiscoveredValues, EndpointRecord, InstanceIntegrations,
    IntegrationsUpdate, LocalEndpoint, RecordedState,
};
use crate::integration_store::{endpoint_key, IntegrationStore, StoreIdentity, StoredEndpoint};
use crate::lock;
use crate::state::{
    AddressView, Availability, DiscoveryView, EndpointView, IntegrationsView, ModuleView,
    RelayView, TestResult, INTEGRATIONS_EVENT,
};
use crate::Companion;

/// The discoverer that reads obs-websocket's config file.
const OBS_WEBSOCKET: &str = "obs-websocket";

/// A discoverer built into this companion, the modules it may serve, and the
/// subprotocols its server speaks.
struct Discoverer {
    id: &'static str,
    /// Module ids allowed to use it. A discoverer can read secrets on this
    /// PC (obs-websocket's password), so a module that merely declares
    /// `known: "<id>"` gets nothing unless it is listed here. Convex enforces
    /// the same list when the companion reports values; this table must stay
    /// in step with `convex/lib/knownDiscoverers.ts`.
    modules: &'static [&'static str],
    /// Offered by the Test button. obs-websocket refuses a handshake that
    /// negotiates neither of its subprotocols, and the engine may speak
    /// either (its client under Bun uses msgpack), so both are offered and
    /// whichever the server picks proves it answers.
    protocols: &'static [&'static str],
}

const DISCOVERERS: &[Discoverer] = &[Discoverer {
    id: OBS_WEBSOCKET,
    modules: &["woofx3_obs"],
    protocols: &["obswebsocket.json", "obswebsocket.msgpack"],
}];

/// How an endpoint may be discovered by this companion.
#[derive(Clone, Copy)]
enum DiscoveryAccess {
    /// It declares no discovery.
    None,
    Permitted(&'static Discoverer),
    /// It names a discoverer this companion has, but its module is not one
    /// that discoverer serves.
    NotPermitted,
    /// It names a discoverer this companion does not have, or mDNS.
    Unsupported,
}

fn discovery_access(module_id: &str, endpoint: &LocalEndpoint) -> DiscoveryAccess {
    if endpoint.discover.is_none() {
        return DiscoveryAccess::None;
    }
    let Some(known) = endpoint.known_discoverer() else {
        return DiscoveryAccess::Unsupported;
    };
    match DISCOVERERS.iter().find(|discoverer| discoverer.id == known) {
        Some(discoverer) if discoverer.modules.contains(&module_id) => {
            DiscoveryAccess::Permitted(discoverer)
        }
        Some(_) => DiscoveryAccess::NotPermitted,
        None => DiscoveryAccess::Unsupported,
    }
}

/// True when the endpoint is served by the named discoverer.
fn discovered_by(module_id: &str, endpoint: &LocalEndpoint, discoverer_id: &str) -> bool {
    matches!(
        discovery_access(module_id, endpoint),
        DiscoveryAccess::Permitted(discoverer) if discoverer.id == discoverer_id
    )
}
/// The discovered address of anything on this PC.
const LOOPBACK_HOST: &str = "127.0.0.1";

const DISCOVERY_INTERVAL: Duration = Duration::from_secs(60);
const TEST_TIMEOUT: Duration = Duration::from_secs(3);
/// After woofx3 refuses a credential, how long before asking again without
/// any other reason to.
const REFUSED_RETRY: Duration = Duration::from_secs(5 * 60);
/// Backoff for subscribing to `forCompanion` again after it failed or ended.
const SUBSCRIBE_BACKOFF: Backoff = Backoff {
    initial: Duration::from_secs(1),
    max: Duration::from_secs(60),
};
/// How long Convex's relay credentials last. Must match
/// RELAY_CREDENTIAL_LIFETIME_SECONDS in convex/lib/relayCredential.ts.
const CREDENTIAL_LIFETIME: Duration = Duration::from_secs(300);
/// A credential's expiry is Convex's clock. Any remaining lifetime shorter
/// than this, or longer than the whole lifetime, is taken as clock skew.
const MIN_PLAUSIBLE_LIFETIME: Duration = Duration::from_secs(30);

/// What the window and the runner share.
pub struct Integrations {
    app: AppHandle,
    cloud: Cloud,
    store: Arc<IntegrationStore>,
    /// Where OBS keeps its config (`%APPDATA%` on Windows). None when the OS
    /// would not say, and then nothing is discovered.
    config_dir: Option<PathBuf>,
    inner: Mutex<Inner>,
    /// Wakes the runner to re-evaluate the relay and rediscover.
    wake: Notify,
    /// Set by an explicit request to connect again, which is the only thing
    /// that lifts a displaced relay.
    retry_relay: AtomicBool,
}

#[derive(Default)]
struct Inner {
    token: Option<String>,
    integrations: Option<Arc<InstanceIntegrations>>,
    availability: Option<Availability>,
    discoveries: HashMap<String, Discovery>,
    report_errors: HashMap<String, String>,
    relay: Option<RelayView>,
}

/// What a discoverer found. The password stays out of it; it is read again
/// for each report and never kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Discovery {
    NotFound,
    ServerOff { port: u16 },
    Found { port: u16, has_password: bool },
    Unreadable,
}

impl Integrations {
    pub fn new(
        app: AppHandle,
        cloud: Cloud,
        app_data_dir: &std::path::Path,
        config_dir: Option<PathBuf>,
    ) -> Self {
        Integrations {
            app,
            cloud,
            store: Arc::new(IntegrationStore::new(app_data_dir)),
            config_dir,
            inner: Mutex::new(Inner::default()),
            wake: Notify::new(),
            retry_relay: AtomicBool::new(false),
        }
    }

    pub fn view(&self) -> IntegrationsView {
        let (integrations, availability, discoveries, report_errors, relay) = {
            let inner = lock(&self.inner);
            (
                inner.integrations.clone(),
                inner.availability.clone(),
                inner.discoveries.clone(),
                inner.report_errors.clone(),
                inner.relay.clone(),
            )
        };
        let Some(availability) = availability else {
            return IntegrationsView::off();
        };
        let stored = self.store.all();
        let modules = integrations
            .as_ref()
            .map(|integrations| {
                integrations
                    .modules
                    .iter()
                    .map(|module| ModuleView {
                        module_id: module.module_id.clone(),
                        module_name: module.module_name.clone(),
                        endpoints: module
                            .endpoints
                            .iter()
                            .map(|endpoint| {
                                let key = endpoint_key(&module.module_id, &endpoint.id);
                                endpoint_view(
                                    &module.module_id,
                                    endpoint,
                                    stored.get(&key),
                                    discoveries.get(&key).copied(),
                                    report_errors.get(&key).cloned(),
                                )
                            })
                            .collect(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        IntegrationsView {
            availability,
            relay_available: integrations.is_some_and(|i| i.relay_available),
            relay: relay.unwrap_or(RelayView::NotNeeded),
            modules,
        }
    }

    fn publish(&self) {
        let view = self.view();
        if let Err(err) = self.app.emit(INTEGRATIONS_EVENT, &view) {
            eprintln!("[companion] could not send integrations to the window: {err}");
        }
    }

    /// Asks the runner to look for OBS again, as when the window gains focus.
    pub fn rediscover(&self) {
        self.wake.notify_one();
    }

    /// Lifts a displaced or refused relay and connects again if needed.
    pub fn reconnect_relay(&self) {
        self.retry_relay.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    /// Drops every stored endpoint, for unpairing.
    pub async fn forget(&self) {
        if let Err(err) = self.store.forget().await {
            eprintln!("[companion] could not forget integrations: {err:#}");
        }
    }

    fn set_relay(&self, relay: RelayView) {
        lock(&self.inner).relay = Some(relay);
        self.publish();
    }

    /// The session's token and the endpoint as an installed module declares
    /// it, or why the window cannot act on it.
    fn target(
        &self,
        module_id: &str,
        endpoint_id: &str,
    ) -> Result<(String, LocalEndpoint), String> {
        let inner = lock(&self.inner);
        let token = inner
            .token
            .clone()
            .ok_or_else(|| "Integrations are not running.".to_string())?;
        let endpoint = inner
            .integrations
            .as_ref()
            .and_then(|integrations| {
                integrations
                    .modules
                    .iter()
                    .find(|module| module.module_id == module_id)
            })
            .and_then(|module| module.endpoints.iter().find(|e| e.id == endpoint_id))
            .cloned()
            .ok_or_else(|| "No module on this instance declares that endpoint.".to_string())?;
        Ok((token, endpoint))
    }

    /// Tells Convex what the store holds for an endpoint, for display in the
    /// browser and so it mints relay credentials while something is enabled.
    async fn record(
        &self,
        token: &str,
        module_id: &str,
        endpoint_id: &str,
        entry: &StoredEndpoint,
    ) -> anyhow::Result<()> {
        let address = entry
            .address
            .as_ref()
            .map(|address| (address.host(), address.port()));
        self.cloud
            .set_endpoint(
                token,
                &EndpointRecord {
                    module_id,
                    endpoint_id,
                    enabled: entry.enabled,
                    address,
                    discovered: entry
                        .address
                        .as_ref()
                        .is_some_and(|address| address.origin() == AddressOrigin::Discovered),
                    shares_password: entry.share_password,
                },
            )
            .await
    }

    /// Turns an endpoint on or off. The store changes first, so the bridge
    /// never serves something the streamer turned off; turning on is undone
    /// if Convex does not take it, since no relay credential would be issued.
    pub async fn set_enabled(
        &self,
        module_id: &str,
        endpoint_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let (token, endpoint) = self.target(module_id, endpoint_id)?;
        let key = endpoint_key(module_id, endpoint_id);
        if enabled {
            if !endpoint.bridgeable() {
                return Err(format!(
                    "{} can't be connected through the companion yet.",
                    endpoint.name
                ));
            }
            let has_address = self
                .store
                .get(&key)
                .is_some_and(|entry| entry.address.is_some());
            if !has_address {
                return Err("Choose an address first.".to_string());
            }
        }
        let previous = self.store.get(&key).unwrap_or_default();
        let entry = self
            .store
            .update(&key, |entry| entry.enabled = enabled)
            .await
            .map_err(|err| format!("{err:#}"))?;
        let recorded = self.record(&token, module_id, endpoint_id, &entry).await;
        if let Err(err) = recorded {
            if enabled {
                if let Err(revert) = self
                    .store
                    .update(&key, |entry| entry.enabled = previous.enabled)
                    .await
                {
                    eprintln!("[companion] could not undo enabling an endpoint: {revert:#}");
                }
                self.publish();
                return Err(format!("Could not turn it on: {err:#}"));
            }
            eprintln!("[companion] woofx3 did not hear that an endpoint was turned off: {err:#}");
        }
        if enabled {
            self.retry_relay.store(true, Ordering::SeqCst);
        }
        self.publish();
        self.wake.notify_one();
        Ok(())
    }

    /// The streamer typed `host:port` and confirmed it.
    pub async fn confirm_address(
        &self,
        module_id: &str,
        endpoint_id: &str,
        input: &str,
    ) -> Result<(), String> {
        let address = ConfirmedAddress::confirmed(input).map_err(|err| format!("{err:#}"))?;
        self.store_address(module_id, endpoint_id, address).await
    }

    /// Uses the address discovery found on this PC.
    pub async fn use_discovered(&self, module_id: &str, endpoint_id: &str) -> Result<(), String> {
        let key = endpoint_key(module_id, endpoint_id);
        let discovery = lock(&self.inner).discoveries.get(&key).copied();
        let Some(Discovery::Found { port, .. }) = discovery else {
            return Err("Nothing was found on this PC to use.".to_string());
        };
        self.store_address(
            module_id,
            endpoint_id,
            ConfirmedAddress::discovered_loopback(port),
        )
        .await
    }

    async fn store_address(
        &self,
        module_id: &str,
        endpoint_id: &str,
        address: ConfirmedAddress,
    ) -> Result<(), String> {
        let (token, _endpoint) = self.target(module_id, endpoint_id)?;
        let key = endpoint_key(module_id, endpoint_id);
        let entry = self
            .store
            .update(&key, |entry| entry.address = Some(address))
            .await
            .map_err(|err| format!("{err:#}"))?;
        // The store is the authority, so a failure here only delays the
        // browser's copy until the next reconcile.
        if let Err(err) = self.record(&token, module_id, endpoint_id, &entry).await {
            eprintln!("[companion] woofx3 did not hear about a new address: {err:#}");
        }
        self.publish();
        self.wake.notify_one();
        Ok(())
    }

    /// The opt-in to send the password found on this PC to woofx3. Turning
    /// it off forgets what was sent, so turning it on again sends it again.
    pub async fn set_share_password(
        &self,
        module_id: &str,
        endpoint_id: &str,
        share: bool,
    ) -> Result<(), String> {
        let (token, endpoint) = self.target(module_id, endpoint_id)?;
        if share && !can_share_password(module_id, &endpoint) {
            return Err("This endpoint has no password the companion can send.".to_string());
        }
        let key = endpoint_key(module_id, endpoint_id);
        let entry = self
            .store
            .update(&key, |entry| {
                entry.share_password = share;
                if !share {
                    entry.sent_password_sha256 = None;
                }
            })
            .await
            .map_err(|err| format!("{err:#}"))?;
        if let Err(err) = self.record(&token, module_id, endpoint_id, &entry).await {
            eprintln!("[companion] woofx3 did not hear about the password choice: {err:#}");
        }
        self.publish();
        self.wake.notify_one();
        Ok(())
    }

    /// One WebSocket handshake with the stored address, enabled or not.
    pub async fn test(&self, module_id: &str, endpoint_id: &str) -> Result<TestResult, String> {
        let (_token, endpoint) = self.target(module_id, endpoint_id)?;
        let address = self
            .store
            .get(&endpoint_key(module_id, endpoint_id))
            .and_then(|entry| entry.address)
            .ok_or_else(|| "Choose an address first.".to_string())?;
        let protocols: Vec<String> = match discovery_access(module_id, &endpoint) {
            DiscoveryAccess::Permitted(discoverer) => {
                discoverer.protocols.iter().map(|p| p.to_string()).collect()
            }
            _ => Vec::new(),
        };
        Ok(match probe(&address, &protocols, TEST_TIMEOUT).await {
            // The probe retries without an offer when the server picks none,
            // which proves only that some WebSocket server answered.
            ProbeOutcome::Reachable { protocol: None } if !protocols.is_empty() => {
                TestResult::Refused {
                    reason: format!("something answered, but not {}", endpoint.name),
                }
            }
            ProbeOutcome::Reachable { protocol } => TestResult::Ok { protocol },
            ProbeOutcome::Refused { reason } => TestResult::Refused { reason },
            ProbeOutcome::TimedOut => TestResult::TimedOut,
        })
    }
}

/// Only the obs-websocket discoverer reads a password, and only for the
/// modules it serves.
fn can_share_password(module_id: &str, endpoint: &LocalEndpoint) -> bool {
    discovered_by(module_id, endpoint, OBS_WEBSOCKET)
        && endpoint
            .keys
            .password
            .as_deref()
            .is_some_and(|key| !endpoint.is_manual(key))
}

fn endpoint_view(
    module_id: &str,
    endpoint: &LocalEndpoint,
    stored: Option<&StoredEndpoint>,
    discovery: Option<Discovery>,
    report_error: Option<String>,
) -> EndpointView {
    let access = discovery_access(module_id, endpoint);
    let discovery = match (access, discovery) {
        (DiscoveryAccess::None, _) => DiscoveryView::Manual,
        (DiscoveryAccess::NotPermitted, _) => DiscoveryView::NotPermitted,
        (DiscoveryAccess::Unsupported, _) => DiscoveryView::Unsupported,
        (DiscoveryAccess::Permitted(_), None) => DiscoveryView::Searching,
        (DiscoveryAccess::Permitted(_), Some(Discovery::NotFound)) => DiscoveryView::NotFound,
        (DiscoveryAccess::Permitted(_), Some(Discovery::ServerOff { port })) => {
            DiscoveryView::ServerOff { port }
        }
        (DiscoveryAccess::Permitted(_), Some(Discovery::Found { port, has_password })) => {
            DiscoveryView::Found { port, has_password }
        }
        (DiscoveryAccess::Permitted(_), Some(Discovery::Unreadable)) => DiscoveryView::Unreadable,
    };
    let discoverer = match access {
        DiscoveryAccess::Permitted(discoverer) => Some(discoverer.id.to_string()),
        _ => None,
    };
    let stored = stored.cloned().unwrap_or_default();
    EndpointView {
        id: endpoint.id.clone(),
        name: endpoint.name.clone(),
        bridgeable: endpoint.bridgeable(),
        discoverer,
        discovery,
        address: stored.address.as_ref().map(|address| AddressView {
            display: address.display(),
            origin: address.origin(),
        }),
        enabled: stored.enabled,
        share_password: stored.share_password,
        can_share_password: can_share_password(module_id, endpoint),
        password_set_by_hand: endpoint
            .keys
            .password
            .as_deref()
            .is_some_and(|key| endpoint.is_manual(key)),
        report_error,
    }
}

/// Mints relay credentials through Convex with the companion's token.
struct CloudCredentials {
    cloud: Cloud,
    token: String,
}

impl CredentialSource for CloudCredentials {
    fn mint(&self) -> BoxFuture<'_, anyhow::Result<Option<RelayGrant>>> {
        Box::pin(async move {
            let Some(reply) = self.cloud.relay_credential(&self.token).await? else {
                return Ok(None);
            };
            // A debug build may point at a relay under `wrangler dev`.
            if !cfg!(debug_assertions) && !reply.relay_url.starts_with("wss://") {
                anyhow::bail!("woofx3 named a relay that is not a secure WebSocket URL");
            }
            Ok(Some(RelayGrant {
                relay_url: reply.relay_url,
                credential: reply.credential,
                expires_at: local_expiry(reply.expires_at, SystemTime::now()),
            }))
        })
    }
}

/// Converts Convex's expiry to this PC's clock. The relay client renews at two
/// thirds of what is left, so a PC clock running ahead would otherwise make it
/// renew in a tight loop, and one running behind would let it expire.
fn local_expiry(expires_at_ms: f64, now: SystemTime) -> SystemTime {
    let fallback = now + CREDENTIAL_LIFETIME;
    // `as` saturates, and turns NaN into 0; the checked add catches a time
    // past what SystemTime can hold.
    let Some(expires_at) =
        UNIX_EPOCH.checked_add(Duration::from_millis(expires_at_ms.max(0.0) as u64))
    else {
        return fallback;
    };
    let remaining = expires_at.duration_since(now).unwrap_or(Duration::ZERO);
    if (MIN_PLAUSIBLE_LIFETIME..=CREDENTIAL_LIFETIME).contains(&remaining) {
        expires_at
    } else {
        fallback
    }
}

/// A relay connection in progress. Dropping it cancels the connection, which
/// closes every bridge before the relay task ends.
struct RelayRun {
    cancel: CancellationToken,
    status: watch::Receiver<RelayStatus>,
}

impl Drop for RelayRun {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

/// Why the relay is held off although endpoints are enabled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Hold {
    /// Until the streamer asks to connect again.
    Displaced,
    /// Until Convex's view changes, the streamer acts, or this time passes.
    Refused { until: Instant },
}

/// Clears the window's integrations when the session ends, however it ends:
/// the runner is aborted together with the paired session.
struct EndOnDrop(Arc<Integrations>);

impl Drop for EndOnDrop {
    fn drop(&mut self) {
        *lock(&self.0.inner) = Inner::default();
        self.0.store.set_installed(HashSet::new());
        self.0.publish();
    }
}

/// Runs integrations for one paired and confirmed session. The caller aborts
/// it when the session ends.
pub async fn run(companion: Arc<Companion>, token: String, identity: StoreIdentity) {
    let integrations = Arc::clone(&companion.integrations);
    {
        let mut inner = lock(&integrations.inner);
        *inner = Inner::default();
        inner.token = Some(token.clone());
        inner.availability = Some(Availability::Loading);
    }
    let _end = EndOnDrop(Arc::clone(&integrations));
    integrations.publish();

    if let Err(err) = integrations.store.load(identity).await {
        eprintln!("[companion] {err:#}");
    }

    let mut runner = Runner {
        integrations: Arc::clone(&integrations),
        token,
        relay: None,
        hold: None,
        reported: HashMap::new(),
    };
    let mut discovery = tokio::time::interval(DISCOVERY_INTERVAL);
    discovery.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut attempt: u32 = 0;
    let mut updates = None;

    loop {
        let refused_until = match runner.hold {
            Some(Hold::Refused { until }) => Some(until),
            _ => None,
        };
        let subscription = match updates.as_mut() {
            Some(subscription) => subscription,
            None => match companion.cloud.watch_integrations(&runner.token).await {
                Ok(subscription) => updates.insert(subscription),
                Err(err) => {
                    eprintln!("[companion] could not follow integrations: {err:#}");
                    lock(&integrations.inner).availability = Some(Availability::Failed {
                        message: "Can't reach woofx3. Trying again…".to_string(),
                    });
                    integrations.publish();
                    tokio::time::sleep(SUBSCRIBE_BACKOFF.delay(attempt)).await;
                    attempt = attempt.saturating_add(1);
                    continue;
                }
            },
        };
        tokio::select! {
            update = subscription.next() => {
                let Some(result) = update else {
                    // The client ended the subscription; follow it again.
                    updates = None;
                    tokio::time::sleep(SUBSCRIBE_BACKOFF.delay(attempt)).await;
                    attempt = attempt.saturating_add(1);
                    continue;
                };
                attempt = 0;
                runner.on_update(IntegrationsUpdate::from_result(result)).await;
            }
            _ = discovery.tick() => {
                runner.discover_and_report().await;
            }
            _ = integrations.wake.notified() => {
                if integrations.retry_relay.swap(false, Ordering::SeqCst) {
                    runner.hold = None;
                }
                runner.evaluate_relay();
                runner.discover_and_report().await;
            }
            status = next_status(&mut runner.relay) => {
                runner.on_relay_status(status);
            }
            _ = tokio::time::sleep_until(refused_until.unwrap_or_else(Instant::now)), if refused_until.is_some() => {
                runner.hold = None;
                runner.evaluate_relay();
            }
        }
    }
}

/// The relay's next status, and whether its task has ended. Pending forever
/// while no relay runs.
async fn next_status(relay: &mut Option<RelayRun>) -> (RelayStatus, bool) {
    let Some(run) = relay.as_mut() else {
        return std::future::pending().await;
    };
    let ended = run.status.changed().await.is_err();
    let status = run.status.borrow_and_update().clone();
    (status, ended)
}

struct Runner {
    integrations: Arc<Integrations>,
    token: String,
    relay: Option<RelayRun>,
    hold: Option<Hold>,
    /// The last report per endpoint, so an unchanged one is not sent again.
    /// Convex rate limits reports, and every settings write makes the engine
    /// reconnect.
    reported: HashMap<String, LastReport>,
}

/// What a report carried, with the password only as its digest.
#[derive(Clone, PartialEq, Eq)]
struct ReportedValues {
    host: Option<String>,
    port: Option<u16>,
    password_sha256: Option<String>,
    /// A change in which keys are manual is a reason to report again.
    manual_keys: Vec<String>,
}

struct LastReport {
    values: ReportedValues,
    /// None once it succeeded. A failed report waits before the same values
    /// are tried again, since every attempt spends the rate limit.
    retry_after: Option<Instant>,
}

const FAILED_REPORT_RETRY: Duration = Duration::from_secs(10 * 60);

impl Runner {
    async fn on_update(&mut self, update: IntegrationsUpdate) {
        let integrations = Arc::clone(&self.integrations);
        match update {
            IntegrationsUpdate::Ready(snapshot) => {
                self.forget_sent_password_on_manual_change(&snapshot).await;
                let installed: HashSet<String> = snapshot
                    .modules
                    .iter()
                    .flat_map(|module| {
                        module
                            .endpoints
                            .iter()
                            .filter(|endpoint| endpoint.bridgeable())
                            .map(|endpoint| endpoint_key(&module.module_id, &endpoint.id))
                    })
                    .collect();
                integrations.store.set_installed(installed);
                {
                    let mut inner = lock(&integrations.inner);
                    inner.integrations = Some(Arc::new(snapshot));
                    inner.availability = Some(Availability::Ready);
                }
                if matches!(self.hold, Some(Hold::Refused { .. })) {
                    self.hold = None;
                }
                integrations.publish();
                self.reconcile().await;
                self.evaluate_relay();
                self.discover_and_report().await;
            }
            IntegrationsUpdate::NotConfirmed => {
                // The pairing session hears the same from `companions:self`
                // and ends this runner; until then, serve nothing.
                self.stop(Availability::Off);
            }
            IntegrationsUpdate::Failed(err) if is_integrations_unavailable(&err) => {
                self.stop(Availability::Unavailable);
            }
            IntegrationsUpdate::Failed(err) => {
                eprintln!("[companion] integrations unavailable for now: {err:#}");
            }
        }
    }

    /// When the password setting becomes manual, or stops being manual
    /// ("Use the companion's value" in the browser), the digest of what was
    /// sent no longer says what the engine holds, so it is dropped and the
    /// password goes again with the next report.
    async fn forget_sent_password_on_manual_change(&self, next: &InstanceIntegrations) {
        let previous = lock(&self.integrations.inner).integrations.clone();
        let Some(previous) = previous else {
            return;
        };
        for module in &next.modules {
            for endpoint in &module.endpoints {
                let Some(password_key) = endpoint.keys.password.as_deref() else {
                    continue;
                };
                let was_manual = previous
                    .modules
                    .iter()
                    .find(|m| m.module_id == module.module_id)
                    .and_then(|m| m.endpoints.iter().find(|e| e.id == endpoint.id))
                    .map(|e| e.is_manual(password_key));
                if was_manual.is_none_or(|was| was == endpoint.is_manual(password_key)) {
                    continue;
                }
                let key = endpoint_key(&module.module_id, &endpoint.id);
                let sent = self
                    .integrations
                    .store
                    .get(&key)
                    .is_some_and(|entry| entry.sent_password_sha256.is_some());
                if !sent {
                    continue;
                }
                let cleared = self
                    .integrations
                    .store
                    .update(&key, |entry| entry.sent_password_sha256 = None)
                    .await;
                if let Err(err) = cleared {
                    eprintln!("[companion] could not forget the sent password: {err:#}");
                }
            }
        }
    }

    fn stop(&mut self, availability: Availability) {
        self.integrations.store.set_installed(HashSet::new());
        {
            let mut inner = lock(&self.integrations.inner);
            inner.integrations = None;
            inner.availability = Some(availability);
        }
        self.evaluate_relay();
        self.integrations.publish();
    }

    /// Brings Convex's copy of each endpoint in line with the store, which
    /// covers a `setEndpoint` that failed and a companion row that was
    /// replaced by pairing again.
    async fn reconcile(&self) {
        let snapshot = lock(&self.integrations.inner).integrations.clone();
        let Some(snapshot) = snapshot else {
            return;
        };
        let stored = self.integrations.store.all();
        for module in &snapshot.modules {
            for endpoint in &module.endpoints {
                let key = endpoint_key(&module.module_id, &endpoint.id);
                let Some(entry) = stored.get(&key) else {
                    continue;
                };
                if !entry.enabled && endpoint.state.is_none() {
                    continue;
                }
                if recorded_matches(endpoint.state.as_ref(), entry) {
                    continue;
                }
                if let Err(err) = self
                    .integrations
                    .record(&self.token, &module.module_id, &endpoint.id, entry)
                    .await
                {
                    eprintln!("[companion] could not update woofx3's copy of an endpoint: {err:#}");
                }
            }
        }
    }

    /// Starts or stops the relay connection. It is held while integrations
    /// are ready, this woofx3 offers the relay, and at least one enabled
    /// endpoint resolves.
    fn evaluate_relay(&mut self) {
        let (ready, relay_available) = {
            let inner = lock(&self.integrations.inner);
            (
                matches!(inner.availability, Some(Availability::Ready)),
                inner
                    .integrations
                    .as_ref()
                    .is_some_and(|integrations| integrations.relay_available),
            )
        };
        let dialable = ready && self.integrations.store.has_dialable();
        let wanted = dialable && relay_available && self.hold.is_none();
        if wanted {
            if self.relay.is_none() {
                self.start_relay();
            }
            return;
        }
        // Dropping the run cancels it.
        self.relay = None;
        let view = match self.hold {
            Some(Hold::Displaced) => RelayView::Displaced,
            Some(Hold::Refused { .. }) => RelayView::Refused,
            None if dialable => RelayView::Unavailable,
            None => RelayView::NotNeeded,
        };
        self.integrations.set_relay(view);
    }

    fn start_relay(&mut self) {
        let cancel = CancellationToken::new();
        let (status_tx, status) = watch::channel(RelayStatus::Connecting);
        let credentials: Arc<dyn CredentialSource> = Arc::new(CloudCredentials {
            cloud: self.integrations.cloud.clone(),
            token: self.token.clone(),
        });
        let endpoints: Arc<dyn EndpointResolver> = self.integrations.store.clone();
        tauri::async_runtime::spawn(run_relay(credentials, endpoints, status_tx, cancel.clone()));
        self.relay = Some(RelayRun { cancel, status });
        self.integrations.set_relay(RelayView::Connecting);
    }

    fn on_relay_status(&mut self, (status, ended): (RelayStatus, bool)) {
        let view = match status {
            RelayStatus::Connecting => RelayView::Connecting,
            RelayStatus::Connected => RelayView::Connected,
            RelayStatus::Retrying { after, error } => RelayView::Retrying {
                retry_at: now_ms().saturating_add(after.as_millis() as u64),
                error,
            },
            RelayStatus::Stopped(stopped) => {
                self.relay = None;
                match stopped {
                    Stopped::Cancelled => {}
                    Stopped::Displaced => self.hold = Some(Hold::Displaced),
                    // Convex refuses a credential when the companion is no
                    // longer paired, which the pairing session hears about
                    // from `companions:self`, or when nothing is enabled on
                    // its side yet, which the next update or reconcile fixes.
                    Stopped::Unauthorized => {
                        self.hold = Some(Hold::Refused {
                            until: Instant::now() + REFUSED_RETRY,
                        })
                    }
                }
                self.evaluate_relay();
                return;
            }
        };
        if ended {
            self.relay = None;
            self.evaluate_relay();
            return;
        }
        self.integrations.set_relay(view);
    }

    /// Reads OBS's config for each endpoint the `obs-websocket` discoverer
    /// serves, keeps a discovered address up to date, and fills in the module
    /// settings for enabled endpoints that dial what was discovered.
    async fn discover_and_report(&mut self) {
        let snapshot = lock(&self.integrations.inner).integrations.clone();
        let Some(snapshot) = snapshot else {
            return;
        };
        let wants_obs = snapshot.modules.iter().any(|module| {
            module
                .endpoints
                .iter()
                .any(|endpoint| discovered_by(&module.module_id, endpoint, OBS_WEBSOCKET))
        });
        if !wants_obs {
            return;
        }
        let read = read_obs_config(self.integrations.config_dir.clone()).await;
        let discovery = match &read {
            Ok(None) => Discovery::NotFound,
            Ok(Some(found)) if !found.server_enabled => Discovery::ServerOff { port: found.port },
            Ok(Some(found)) => Discovery::Found {
                port: found.port,
                has_password: found.password.is_some(),
            },
            Err(err) => {
                eprintln!("[companion] could not read OBS's WebSocket settings: {err:#}");
                Discovery::Unreadable
            }
        };
        let found = match read {
            Ok(Some(found)) if found.server_enabled => Some(found),
            _ => None,
        };

        for module in &snapshot.modules {
            for endpoint in &module.endpoints {
                if !discovered_by(&module.module_id, endpoint, OBS_WEBSOCKET) {
                    continue;
                }
                let key = endpoint_key(&module.module_id, &endpoint.id);
                lock(&self.integrations.inner)
                    .discoveries
                    .insert(key.clone(), discovery);
                if let Some(found) = &found {
                    self.follow_port(&module.module_id, endpoint, found.port)
                        .await;
                    self.report(&module.module_id, endpoint, found).await;
                }
            }
        }
        self.integrations.publish();
    }

    /// OBS's port changed: an enabled endpoint dialling the discovered
    /// address follows it.
    async fn follow_port(&self, module_id: &str, endpoint: &LocalEndpoint, port: u16) {
        let key = endpoint_key(module_id, &endpoint.id);
        let Some(entry) = self.integrations.store.get(&key) else {
            return;
        };
        let follows = entry.enabled
            && entry.address.as_ref().is_some_and(|address| {
                address.origin() == AddressOrigin::Discovered && address.port() != port
            });
        if !follows {
            return;
        }
        let updated = self
            .integrations
            .store
            .update(&key, |entry| {
                entry.address = Some(ConfirmedAddress::discovered_loopback(port))
            })
            .await;
        match updated {
            Ok(entry) => {
                if let Err(err) = self
                    .integrations
                    .record(&self.token, module_id, &endpoint.id, &entry)
                    .await
                {
                    eprintln!("[companion] woofx3 did not hear about OBS's new port: {err:#}");
                }
            }
            Err(err) => eprintln!("[companion] could not store OBS's new port: {err:#}"),
        }
    }

    /// Sends what discovery found for an enabled endpoint that dials the
    /// discovered address. An address the streamer typed may be another PC,
    /// whose settings this PC's OBS config says nothing about. The password
    /// goes only with the streamer's opt-in, and only when it changed.
    async fn report(&mut self, module_id: &str, endpoint: &LocalEndpoint, found: &ObsDiscovery) {
        let key = endpoint_key(module_id, &endpoint.id);
        let Some(entry) = self.integrations.store.get(&key) else {
            return;
        };
        let dials_discovered = entry
            .address
            .as_ref()
            .is_some_and(|address| address.origin() == AddressOrigin::Discovered);
        if !entry.enabled || !dials_discovered || !endpoint.bridgeable() {
            return;
        }
        let values = report_values(module_id, endpoint, &entry, found);
        if values.host.is_none() && values.port.is_none() && values.password.is_none() {
            return;
        }
        let sent_password = values
            .password
            .as_deref()
            .map(obs_config::password_sha256_hex);
        let memo = ReportedValues {
            host: values.host.clone(),
            port: values.port,
            password_sha256: sent_password.clone(),
            manual_keys: endpoint.manual_keys.clone(),
        };
        let wait = self.reported.get(&key).is_some_and(|last| {
            last.values == memo
                && last
                    .retry_after
                    .is_none_or(|retry_after| Instant::now() < retry_after)
        });
        if wait {
            return;
        }
        let reported = self
            .integrations
            .cloud
            .report_discovered(&self.token, module_id, &endpoint.id, &values)
            .await;
        match reported {
            Ok(()) => {
                // Once its digest is stored, the password is not part of the
                // next report, so the memo leaves it out too.
                self.reported.insert(
                    key.clone(),
                    LastReport {
                        values: ReportedValues {
                            password_sha256: None,
                            ..memo
                        },
                        retry_after: None,
                    },
                );
                lock(&self.integrations.inner).report_errors.remove(&key);
                if let Some(digest) = sent_password {
                    let stored = self
                        .integrations
                        .store
                        .update(&key, |entry| entry.sent_password_sha256 = Some(digest))
                        .await;
                    if let Err(err) = stored {
                        eprintln!(
                            "[companion] could not record that the password was sent: {err:#}"
                        );
                    }
                }
            }
            Err(err) => {
                eprintln!("[companion] could not fill in module settings: {err:#}");
                self.reported.insert(
                    key.clone(),
                    LastReport {
                        values: memo,
                        retry_after: Some(Instant::now() + FAILED_REPORT_RETRY),
                    },
                );
                lock(&self.integrations.inner)
                    .report_errors
                    .insert(key, format!("{err:#}"));
            }
        }
    }
}

/// What to report for an endpoint: the discovered host and port, and the
/// password when the streamer opted in and it changed since it was last
/// sent. Keys the streamer set by hand are left out.
fn report_values(
    module_id: &str,
    endpoint: &LocalEndpoint,
    entry: &StoredEndpoint,
    found: &ObsDiscovery,
) -> DiscoveredValues {
    let host = (!endpoint.is_manual(&endpoint.keys.host)).then(|| LOOPBACK_HOST.to_string());
    let port = (!endpoint.is_manual(&endpoint.keys.port)).then_some(found.port);
    let password = found.password.as_ref().filter(|password| {
        entry.share_password
            && can_share_password(module_id, endpoint)
            && entry.sent_password_sha256.as_deref()
                != Some(obs_config::password_sha256_hex(password).as_str())
    });
    DiscoveredValues {
        host,
        port,
        password: password.cloned(),
    }
}

/// Whether Convex's copy already says what the store holds.
fn recorded_matches(recorded: Option<&RecordedState>, entry: &StoredEndpoint) -> bool {
    let Some(recorded) = recorded else {
        return false;
    };
    let address_matches = match (&recorded.address, &entry.address) {
        (None, None) => true,
        (Some(recorded), Some(stored)) => {
            recorded.host == stored.host() && recorded.port == f64::from(stored.port())
        }
        _ => false,
    };
    let discovered = entry
        .address
        .as_ref()
        .is_some_and(|address| address.origin() == AddressOrigin::Discovered);
    recorded.enabled == entry.enabled
        && address_matches
        && recorded.discovered == discovered
        && recorded.shares_password == entry.share_password
}

async fn read_obs_config(config_dir: Option<PathBuf>) -> anyhow::Result<Option<ObsDiscovery>> {
    let Some(config_dir) = config_dir else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || obs_config::read(&config_dir))
        .await
        .map_err(|err| anyhow::anyhow!("the OBS discovery task failed: {err}"))?
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::{Discover, RecordedAddress, SettingKeys};

    const OBS_MODULE: &str = "woofx3_obs";

    fn obs_endpoint(manual_keys: &[&str]) -> LocalEndpoint {
        LocalEndpoint {
            id: "obs".into(),
            name: "OBS WebSocket".into(),
            protocol: "websocket".into(),
            discover: Some(Discover {
                mdns: None,
                known: Some(OBS_WEBSOCKET.into()),
            }),
            keys: SettingKeys {
                host: "host".into(),
                port: "port".into(),
                password: Some("password".into()),
            },
            state: None,
            manual_keys: manual_keys.iter().map(|key| key.to_string()).collect(),
        }
    }

    fn found(password: Option<&str>) -> ObsDiscovery {
        ObsDiscovery {
            server_enabled: true,
            port: 4456,
            password: password.map(str::to_string),
        }
    }

    fn enabled_discovered() -> StoredEndpoint {
        StoredEndpoint {
            enabled: true,
            address: Some(ConfirmedAddress::discovered_loopback(4456)),
            share_password: false,
            sent_password_sha256: None,
        }
    }

    #[test]
    fn reports_host_and_port_but_no_password_without_the_opt_in() {
        let values = report_values(
            OBS_MODULE,
            &obs_endpoint(&[]),
            &enabled_discovered(),
            &found(Some("pw")),
        );
        assert_eq!(values.host.as_deref(), Some(LOOPBACK_HOST));
        assert_eq!(values.port, Some(4456));
        assert_eq!(values.password, None);
    }

    #[test]
    fn sends_the_password_with_the_opt_in_only_when_it_changed() {
        let mut entry = enabled_discovered();
        entry.share_password = true;
        let values = report_values(OBS_MODULE, &obs_endpoint(&[]), &entry, &found(Some("pw")));
        assert_eq!(values.password.as_deref(), Some("pw"));

        entry.sent_password_sha256 = Some(obs_config::password_sha256_hex("pw"));
        let again = report_values(OBS_MODULE, &obs_endpoint(&[]), &entry, &found(Some("pw")));
        assert_eq!(again.password, None);
        let changed = report_values(OBS_MODULE, &obs_endpoint(&[]), &entry, &found(Some("new")));
        assert_eq!(changed.password.as_deref(), Some("new"));
    }

    #[test]
    fn leaves_out_keys_the_streamer_set_by_hand() {
        let mut entry = enabled_discovered();
        entry.share_password = true;
        let values = report_values(
            OBS_MODULE,
            &obs_endpoint(&["host", "port", "password"]),
            &entry,
            &found(Some("pw")),
        );
        assert_eq!(values.host, None);
        assert_eq!(values.port, None);
        assert_eq!(values.password, None);
    }

    #[test]
    fn a_password_typed_by_hand_cannot_be_shared() {
        assert!(can_share_password(OBS_MODULE, &obs_endpoint(&[])));
        assert!(!can_share_password(
            OBS_MODULE,
            &obs_endpoint(&["password"])
        ));
        let mut no_password = obs_endpoint(&[]);
        no_password.keys.password = None;
        assert!(!can_share_password(OBS_MODULE, &no_password));
    }

    #[test]
    fn compares_convex_copy_with_the_store() {
        let entry = enabled_discovered();
        let recorded = RecordedState {
            enabled: true,
            address: Some(RecordedAddress {
                host: LOOPBACK_HOST.into(),
                port: 4456.0,
            }),
            discovered: true,
            shares_password: false,
        };
        assert!(recorded_matches(Some(&recorded), &entry));
        assert!(!recorded_matches(None, &entry));
        let moved = RecordedState {
            address: Some(RecordedAddress {
                host: LOOPBACK_HOST.into(),
                port: 4455.0,
            }),
            ..recorded.clone()
        };
        assert!(!recorded_matches(Some(&moved), &entry));
        let off = RecordedState {
            enabled: false,
            ..recorded
        };
        assert!(!recorded_matches(Some(&off), &entry));
    }

    #[test]
    fn views_discovery_by_discoverer() {
        let mut manual = obs_endpoint(&[]);
        manual.discover = None;
        assert_eq!(
            endpoint_view(OBS_MODULE, &manual, None, None, None).discovery,
            DiscoveryView::Manual
        );
        let mut mdns = obs_endpoint(&[]);
        mdns.discover = Some(Discover {
            mdns: Some("_elg._tcp".into()),
            known: None,
        });
        assert_eq!(
            endpoint_view(OBS_MODULE, &mdns, None, None, None).discovery,
            DiscoveryView::Unsupported
        );
        let obs = obs_endpoint(&[]);
        assert_eq!(
            endpoint_view(OBS_MODULE, &obs, None, None, None).discovery,
            DiscoveryView::Searching
        );
        assert_eq!(
            endpoint_view(
                OBS_MODULE,
                &obs,
                None,
                Some(Discovery::ServerOff { port: 4455 }),
                None
            )
            .discovery,
            DiscoveryView::ServerOff { port: 4455 }
        );
    }

    #[test]
    fn a_module_the_discoverer_does_not_serve_gets_no_discovery_or_password() {
        let endpoint = obs_endpoint(&[]);
        let view = endpoint_view("someone_elses_module", &endpoint, None, None, None);
        assert_eq!(view.discovery, DiscoveryView::NotPermitted);
        assert_eq!(view.discoverer, None);
        assert!(!view.can_share_password);
        assert!(!discovered_by(
            "someone_elses_module",
            &endpoint,
            OBS_WEBSOCKET
        ));

        let mut entry = enabled_discovered();
        entry.share_password = true;
        let values = report_values(
            "someone_elses_module",
            &endpoint,
            &entry,
            &found(Some("pw")),
        );
        assert_eq!(values.password, None);

        let served = endpoint_view(OBS_MODULE, &endpoint, None, None, None);
        assert_eq!(served.discoverer.as_deref(), Some(OBS_WEBSOCKET));
    }

    #[test]
    fn an_absurd_expiry_falls_back_to_the_credential_lifetime() {
        let now = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        for expires_at in [f64::MAX, f64::INFINITY, f64::NAN, -1.0, 1e300] {
            assert_eq!(local_expiry(expires_at, now), now + CREDENTIAL_LIFETIME);
        }
    }

    #[test]
    fn trusts_convex_expiry_only_within_the_credential_lifetime() {
        let now = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let ms = |time: SystemTime| time.duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let in_four_minutes = now + Duration::from_secs(240);
        assert_eq!(local_expiry(ms(in_four_minutes), now), in_four_minutes);
        // This PC's clock runs ahead: the credential looks already expired.
        assert_eq!(
            local_expiry(ms(now - Duration::from_secs(60)), now),
            now + CREDENTIAL_LIFETIME
        );
        // This PC's clock runs behind: the credential looks too long-lived.
        assert_eq!(
            local_expiry(ms(now + Duration::from_secs(3600)), now),
            now + CREDENTIAL_LIFETIME
        );
    }
}
