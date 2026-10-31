//! The woofx3 companion: a tray app that pairs this computer with a woofx3
//! instance through the browser and stays connected to Convex while paired.
//! An unpaired companion holds no Convex connection. Its window
//! renders `WindowState`; all work happens here, in Rust commands.
//!
//! In local mode, chosen by the host configuration file, it also runs the
//! engine's orchestrator as its sidecar (`engine_host`), and stops it before
//! it quits. There it also keeps the shoutout queue and the stream start
//! marker for the window, which reaches them through the local-mode commands.
//!
//! The same crate builds two products: the companion, and the desktop app
//! (the `bundled-engine` feature with `tauri.woofx3.conf.json`). Whatever
//! names the product or files its state on the PC comes from the running
//! app's Tauri config (`AppIdentity`), so the two install side by side and
//! never share credentials or data.
//!
//! Commands are async so none of them runs on the main thread: tray updates
//! (`MenuItem::set_text`) dispatch to the main thread and wait for it, so a
//! command blocking the main thread on a lock that a state update holds
//! would deadlock. Locks here are never held across a call into Tauri.

mod cloud;
#[cfg(test)]
mod convex_url;
mod credentials;
mod engine_host;
mod installation;
mod integration_store;
mod integrations;
mod pairing;
mod startup_failure;
mod tray;
mod update;

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use woofx3_companion_core::host::{
    choose_host_mode as write_host_mode, HostConfig, HostMode, HostModeKind, LocalEngineSettings,
    MarkerRequestOutcome, ShoutoutEnqueued, ShoutoutQueueView, StreamStartMarker, HOST_CONFIG_FILE,
};

use cloud::CloudLink;
use credentials::{Credentials, StoredToken};
use engine_host::LocalEngine;
use integrations::Integrations;
use tray::Tray;
use update::Downloaded;
use woofx3_companion_core::twitch_sign_in::{convex_site_url, twitch_sign_in_url};
use woofx3_companion_core::window::{
    AppLinkStart, ChooseHostModeArgs, CompanionLinkStatus, CompanionState, ConfirmAddressArgs,
    EnqueueShoutoutArgs, FinishAppLinkArgs, HostModeView, IntegrationsView, LocalEngineSession,
    OpenTwitchSignInArgs, ReadyUpdate, RemoveShoutoutArgs, ReorderShoutoutsArgs,
    SetEndpointEnabledArgs, SetSharePasswordArgs, TestEndpointArgs, TestResult, UseDiscoveredArgs,
    WindowState, STATE_EVENT,
};
use woofx3_companion_core::AppIdentity;

/// Shared by the commands, the tray and the running flow.
pub struct Companion {
    app: AppHandle,
    /// Which product this is: the companion or the desktop app.
    identity: AppIdentity,
    credentials: Credentials,
    /// The version Convex is told this app runs: the Tauri config's, which
    /// the updater compares and each product sets for itself.
    version: String,
    cloud_link: CloudLink,
    engine: LocalEngine,
    /// The mode this run started in, and whether the streamer chose it.
    host: HostModeView,
    /// Where the mode is chosen; written once, by `choose_host_mode`.
    host_config_path: std::path::PathBuf,
    installation_id: String,
    /// Local endpoints served over the relay while paired and confirmed.
    integrations: Arc<Integrations>,
    /// The pairing state and the ready update's version under one lock, so
    /// every snapshot sent to the window is consistent.
    view: Mutex<WindowState>,
    /// The update behind `view.update`, kept apart because it holds the
    /// installer's bytes and only `install_update` needs them.
    ready_update: Mutex<Option<Arc<Downloaded>>>,
    /// The pairing attempt or paired session in progress. Starting another
    /// aborts it, so there is only ever one subscription set per token.
    flow: Mutex<Option<JoinHandle<()>>>,
    /// Set from a start request until its code is showing, so a double click
    /// cannot start two pairings.
    starting: AtomicBool,
    /// The pending pairing's device code, kept so cancelling can tell Convex.
    device_code: Mutex<Option<String>>,
    verification_url: Mutex<Option<String>>,
    /// The token `begin_app_link` handed out the hash of, until
    /// `finish_app_link` stores it. Only in memory: a link that never
    /// finishes leaves nothing behind on this PC.
    pending_link: Mutex<Option<String>>,
    tray: Mutex<Option<Tray>>,
}

/// A poisoned lock only means another thread panicked mid-update; the data is
/// still a whole value, so keep going rather than take the tray down.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Companion {
    pub fn state(&self) -> CompanionState {
        lock(&self.view).state.clone()
    }

    fn window_state(&self) -> WindowState {
        lock(&self.view).clone()
    }

    fn tray(&self) -> Option<Tray> {
        lock(&self.tray).clone()
    }

    fn send_to_window(&self, view: &WindowState) {
        if let Err(err) = self.app.emit(STATE_EVENT, view) {
            eprintln!("[companion] could not send state to the window: {err}");
        }
    }

    /// Stores the state, pushes it to the window and refreshes the tray.
    pub fn set_state(&self, next: CompanionState) {
        let label = next.tray_label();
        let view = {
            let mut view = lock(&self.view);
            view.state = next;
            view.clone()
        };
        self.send_to_window(&view);
        if let Some(tray) = self.tray() {
            if let Err(err) = tray.status.set_text(label) {
                eprintln!("[companion] could not update the tray: {err}");
            }
        }
    }

    fn ready_update(&self) -> Option<Arc<Downloaded>> {
        lock(&self.ready_update).clone()
    }

    /// Keeps a downloaded update for `install_update` and offers it in the
    /// window and the tray. A newer download replaces an older one.
    fn set_ready_update(&self, downloaded: Downloaded) {
        let ready = ReadyUpdate {
            product_name: self.identity.product_name().to_string(),
            version: downloaded.version().to_string(),
        };
        *lock(&self.ready_update) = Some(Arc::new(downloaded));
        let view = {
            let mut view = lock(&self.view);
            view.update = Some(ready.clone());
            view.clone()
        };
        self.send_to_window(&view);
        if let Some(tray) = self.tray() {
            if let Err(err) = tray.show_update(&ready) {
                eprintln!("[companion] could not add the update to the tray: {err}");
            }
        }
    }

    /// Claims the right to start pairing: only from Unpaired or Error, and
    /// only once until the claim is released.
    fn try_begin_start(&self) -> bool {
        let view = lock(&self.view);
        if !matches!(
            view.state,
            CompanionState::Unpaired | CompanionState::Error { .. }
        ) {
            return false;
        }
        !self.starting.swap(true, Ordering::SeqCst)
    }

    fn end_start(&self) {
        self.starting.store(false, Ordering::SeqCst);
    }

    fn replace_flow(&self, next: Option<JoinHandle<()>>) {
        let previous = std::mem::replace(&mut *lock(&self.flow), next);
        if let Some(handle) = previous {
            handle.abort();
        }
    }

    fn verification_url(&self) -> Option<String> {
        lock(&self.verification_url).clone()
    }

    fn set_verification_url(&self, url: Option<String>) {
        *lock(&self.verification_url) = url;
    }

    fn set_device_code(&self, device_code: Option<String>) {
        *lock(&self.device_code) = device_code;
    }

    fn pending_link(&self) -> Option<String> {
        lock(&self.pending_link).clone()
    }

    /// Drops the pending token once it is stored, unless a newer
    /// `begin_app_link` has replaced it meanwhile.
    fn clear_pending_link(&self, stored: &str) {
        let mut pending = lock(&self.pending_link);
        if pending.as_deref() == Some(stored) {
            *pending = None;
        }
    }

    /// Shows the companion window: pairing, its confirmation and errors need
    /// the streamer there.
    pub fn show_window(&self) {
        show_window(&self.app, COMPANION_WINDOW);
    }

    /// Picks up where the last run left off, from the stored token. Only a
    /// stored token opens the Convex connection; without one the companion
    /// stays off the cloud until a pairing starts.
    async fn resume(self: Arc<Self>) {
        match self.credentials.load().await {
            // The dashboard window is already open; pairing waits until the
            // streamer asks for it.
            Ok(None) => {
                self.set_state(CompanionState::Unpaired);
            }
            Ok(Some(stored)) => {
                if !stored.confirmed {
                    self.show_window();
                }
                let session =
                    tauri::async_runtime::spawn(pairing::run_session(Arc::clone(&self), stored));
                self.replace_flow(Some(session));
            }
            Err(err) => {
                self.set_state(CompanionState::Error {
                    message: format!("{err:#}"),
                });
                self.show_window();
            }
        }
    }

    /// Stops whatever is running and gives up the stored token and any
    /// pending pairing, locally at once and on the server in the background.
    async fn stop_and_forget(self: &Arc<Self>) -> Result<(), String> {
        self.replace_flow(None);
        self.end_start();
        self.set_verification_url(None);
        let device_code = lock(&self.device_code).take();
        let token = self
            .credentials
            .load()
            .await
            .map_err(|err| format!("{err:#}"))?
            .map(|stored| stored.token);
        pairing::forget_and_unpair(self, token, device_code).await;
        Ok(())
    }
}

/// The window that shows the dashboard. Must match tauri.conf.json.
pub const DASHBOARD_WINDOW: &str = "main";
/// The window that shows pairing and local connections. Must match
/// tauri.conf.json and capabilities/companion.json, which grants the
/// companion's commands to it alone.
pub const COMPANION_WINDOW: &str = "companion";

pub fn show_window(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
async fn get_state(companion: State<'_, Arc<Companion>>) -> Result<WindowState, String> {
    Ok(companion.window_state())
}

/// Ignored unless the companion is unpaired or showing an error, and while
/// another start is still asking for a code.
#[tauri::command]
async fn start_pairing(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    if !companion.try_begin_start() {
        return Ok(());
    }
    let flow = tauri::async_runtime::spawn(pairing::pair(Arc::clone(&companion)));
    companion.replace_flow(Some(flow));
    Ok(())
}

#[tauri::command]
async fn cancel_pairing(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    companion.stop_and_forget().await
}

#[tauri::command]
async fn open_verification_url(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    pairing::open_verification_url(&companion);
    Ok(())
}

/// The person at this PC accepts who approved the pairing; only now does the
/// token count as this computer's.
#[tauri::command]
async fn confirm_pairing(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    let CompanionState::ConfirmPairing { instance_name, .. } = companion.state() else {
        return Err("There is no pairing waiting to be confirmed.".to_string());
    };
    pairing::confirm(Arc::clone(&companion), instance_name).await
}

#[tauri::command]
async fn reject_pairing(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    companion.stop_and_forget().await
}

#[tauri::command]
async fn unpair(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    companion.stop_and_forget().await
}

/// Installs the downloaded update and restarts into it. Returns only if that
/// fails, in which case the update stays ready.
#[tauri::command]
async fn install_update(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    update::install(&companion)
        .await
        .inspect_err(|err| eprintln!("[companion] {err}"))
}

#[tauri::command]
async fn get_integrations(
    companion: State<'_, Arc<Companion>>,
) -> Result<IntegrationsView, String> {
    Ok(companion.integrations.view())
}

/// Turning an endpoint on needs an address, discovered or confirmed.
#[tauri::command]
async fn set_endpoint_enabled(
    companion: State<'_, Arc<Companion>>,
    args: SetEndpointEnabledArgs,
) -> Result<(), String> {
    companion
        .integrations
        .set_enabled(&args.module_id, &args.endpoint_id, args.enabled)
        .await
}

/// The streamer typed `host:port` and pressed Confirm address.
#[tauri::command]
async fn confirm_address(
    companion: State<'_, Arc<Companion>>,
    args: ConfirmAddressArgs,
) -> Result<(), String> {
    companion
        .integrations
        .confirm_address(&args.module_id, &args.endpoint_id, &args.address)
        .await
}

#[tauri::command]
async fn use_discovered(
    companion: State<'_, Arc<Companion>>,
    args: UseDiscoveredArgs,
) -> Result<(), String> {
    companion
        .integrations
        .use_discovered(&args.module_id, &args.endpoint_id)
        .await
}

#[tauri::command]
async fn set_share_password(
    companion: State<'_, Arc<Companion>>,
    args: SetSharePasswordArgs,
) -> Result<(), String> {
    companion
        .integrations
        .set_share_password(&args.module_id, &args.endpoint_id, args.share)
        .await
}

#[tauri::command]
async fn test_endpoint(
    companion: State<'_, Arc<Companion>>,
    args: TestEndpointArgs,
) -> Result<TestResult, String> {
    companion
        .integrations
        .test(&args.module_id, &args.endpoint_id)
        .await
}

/// What the window needs to open a capnweb session with the local engine.
/// Only the companion window can call it (capabilities/companion.json).
#[tauri::command]
async fn local_engine_session(
    companion: State<'_, Arc<Companion>>,
) -> Result<LocalEngineSession, String> {
    Ok(companion.engine.session())
}

/// The local shoutout queue, in order, and why it is paused, if it is.
/// Local mode only, like every shoutout and marker command below.
#[tauri::command]
async fn shoutout_queue(companion: State<'_, Arc<Companion>>) -> Result<ShoutoutQueueView, String> {
    companion.engine.shoutout_queue()
}

/// A channel already waiting keeps its place.
#[tauri::command]
async fn enqueue_shoutout(
    companion: State<'_, Arc<Companion>>,
    args: EnqueueShoutoutArgs,
) -> Result<ShoutoutEnqueued, String> {
    companion.engine.enqueue_shoutout(args.channel)
}

#[tauri::command]
async fn remove_shoutout(
    companion: State<'_, Arc<Companion>>,
    args: RemoveShoutoutArgs,
) -> Result<(), String> {
    companion.engine.remove_shoutout(args.entry_id)
}

/// An entry gone meanwhile is skipped; entries left out keep their order
/// after the ones named.
#[tauri::command]
async fn reorder_shoutouts(
    companion: State<'_, Arc<Companion>>,
    args: ReorderShoutoutsArgs,
) -> Result<(), String> {
    companion.engine.reorder_shoutouts(&args.entry_ids)
}

#[tauri::command]
async fn stream_start_marker(
    companion: State<'_, Arc<Companion>>,
) -> Result<StreamStartMarker, String> {
    companion.engine.stream_start_marker()
}

/// Drops the "Stream start" marker now when the stream is live, else when
/// it next goes live.
#[tauri::command]
async fn request_stream_start_marker(
    companion: State<'_, Arc<Companion>>,
) -> Result<MarkerRequestOutcome, String> {
    companion.engine.request_stream_start_marker().await
}

/// The mode this run started in, and whether the streamer chose it.
#[tauri::command]
async fn host_mode(companion: State<'_, Arc<Companion>>) -> Result<HostModeView, String> {
    Ok(companion.host.clone())
}

/// Records the streamer's first choice of mode and restarts into it. The
/// engine is stopped first: a restart skips the exit hook that otherwise
/// stops it, and the next run may not start one at all. Refused once a mode
/// is chosen, so hand-written settings are never replaced.
#[tauri::command]
async fn choose_host_mode(
    companion: State<'_, Arc<Companion>>,
    args: ChooseHostModeArgs,
) -> Result<(), String> {
    write_host_mode(&companion.host_config_path, args.mode).map_err(|err| format!("{err:#}"))?;
    companion.engine.stop().await;
    companion.app.request_restart();
    Ok(())
}

/// Whether this computer is already a companion, and of which instance, with
/// what the dashboard sends Convex to link it.
#[tauri::command]
async fn companion_link_status(
    companion: State<'_, Arc<Companion>>,
) -> Result<CompanionLinkStatus, String> {
    let stored = companion
        .credentials
        .load()
        .await
        .map_err(|err| format!("{err:#}"))?;
    Ok(CompanionLinkStatus {
        linked: stored.as_ref().and_then(StoredToken::linked_instance),
        installation_id: companion.installation_id.clone(),
        device_name: pairing::device_name(),
        companion_version: companion.version.clone(),
    })
}

/// Starts making this computer the signed-in instance's companion: a fresh
/// token, kept here, whose hash the dashboard gives Convex. Starting again
/// replaces a token that never finished. Companion mode only, since local
/// mode has no account to link to.
#[tauri::command]
async fn begin_app_link(companion: State<'_, Arc<Companion>>) -> Result<AppLinkStart, String> {
    if companion.host.mode != HostModeKind::Companion {
        return Err("Linking to an account needs the app signed in to one.".to_string());
    }
    let token = credentials::generate_token().map_err(|err| format!("{err:#}"))?;
    let token_hash = credentials::hash_token(&token);
    *lock(&companion.pending_link) = Some(token);
    Ok(AppLinkStart {
        token_hash,
        installation_id: companion.installation_id.clone(),
        device_name: pairing::device_name(),
        companion_version: companion.version.clone(),
    })
}

/// Convex recorded this computer as the instance's companion: stores the
/// pending token as the confirmed pairing and starts the paired session.
#[tauri::command]
async fn finish_app_link(
    companion: State<'_, Arc<Companion>>,
    args: FinishAppLinkArgs,
) -> Result<(), String> {
    pairing::finish_app_link(Arc::clone(&companion), args).await
}

/// The deployment's HTTP origin, when it is not derived from
/// `WOOFX3_CONVEX_URL`: the variable the dashboard's build reads too
/// (vite.config.ts), so both open the same origin.
const CONVEX_SITE_URL: Option<&str> = option_env!("WOOFX3_CONVEX_SITE_URL");

/// Opens the system browser at Convex's Twitch sign-in, bound to the nonce
/// the dashboard keeps. The window names only the nonce's hash; the address
/// is built here from the deployment compiled in, so the window cannot have
/// the host open any other page. Companion mode only, since local mode has
/// no account to sign in to.
#[tauri::command]
async fn open_twitch_sign_in(
    companion: State<'_, Arc<Companion>>,
    args: OpenTwitchSignInArgs,
) -> Result<(), String> {
    if companion.host.mode != HostModeKind::Companion {
        return Err("Signing in to an account needs the app set up to use one.".to_string());
    }
    let site_url = convex_site_url(cloud::CONVEX_URL, CONVEX_SITE_URL);
    let url = twitch_sign_in_url(&site_url, &args.nonce_hash).map_err(|err| err.to_string())?;
    companion
        .app
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|err| format!("Could not open the browser: {err}"))
}

/// Connects to the relay again after another connection displaced this one
/// or woofx3 refused a credential.
#[tauri::command]
async fn reconnect_relay(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    companion.integrations.reconnect_relay();
    Ok(())
}

/// Marks a command that takes arguments, as its `args` parameter.
struct WithArgs;
/// Marks a command that takes none.
struct NoArgs;

/// A command taking the arguments `A` and resolving to `R`, the types the
/// command list declares for it. `Marker` tells the two shapes apart:
/// rustc cannot tell two blanket impls for `F` apart by their bounds alone.
trait CommandSignature<A, R, Marker> {}

impl<F, Fut, A, R> CommandSignature<A, R, WithArgs> for F
where
    F: Fn(State<'static, Arc<Companion>>, A) -> Fut,
    Fut: Future<Output = Result<R, String>>,
{
}

impl<F, Fut, R> CommandSignature<(), R, NoArgs> for F
where
    F: Fn(State<'static, Arc<Companion>>) -> Fut,
    Fut: Future<Output = Result<R, String>>,
{
}

/// Compiles only when `command` has the declared signature.
const fn declared<A, R, M, F: CommandSignature<A, R, M>>(_command: &F) {}

/// Checks every command against the list's `name(Args) -> Result` at compile
/// time, so a command whose argument or result type drifts from what the
/// window's generated bindings say fails the build instead of a call.
macro_rules! check_command_signatures {
    ($($name:ident($args:ty) -> $result:ty),* $(,)?) => {
        const _: () = { $( declared::<$args, $result, _, _>(&$name); )* };
    };
}

woofx3_companion_core::with_command_names!(check_command_signatures);

macro_rules! command_handler {
    ($($name:ident($args:ty) -> $result:ty),* $(,)?) => {
        tauri::generate_handler![$($name),*]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    woofx3_companion_core::install_tls_provider();
    tauri::Builder::default()
        // First, so a second launch hands over to this one before it opens a
        // second Convex connection.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, DASHBOARD_WINDOW);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let identity = AppIdentity::new(
                &app.config().identifier,
                app.config().product_name.as_deref().unwrap_or_default(),
            )?;
            let credentials = Credentials::new(&identity);
            let app_data_dir = app.path().app_data_dir()?;
            let started = load_host_config(app).and_then(|(path, config)| {
                let engine = start_local_engine(app, &config, &credentials)?;
                Ok((path, config, engine))
            });
            let (host_config_path, host_config, engine) = match started {
                Ok(started) => started,
                Err(err) => {
                    startup_failure::report(
                        app.path().app_log_dir().ok().as_deref(),
                        &identity.startup_failure_title(),
                        &format!("{err:#}"),
                    );
                    std::process::exit(1);
                }
            };
            let installation_id = installation::load_or_create(&app_data_dir)?;
            let integrations = Arc::new(Integrations::new(
                handle.clone(),
                &app_data_dir,
                app.path().config_dir().ok(),
            ));
            let companion = Arc::new(Companion {
                app: handle.clone(),
                version: app.package_info().version.to_string(),
                identity,
                credentials,
                cloud_link: CloudLink::dormant(),
                engine,
                host: HostModeView {
                    mode: HostModeKind::of(&host_config.mode),
                    chosen: host_config.chosen,
                },
                host_config_path,
                installation_id,
                integrations,
                view: Mutex::new(WindowState {
                    state: CompanionState::Starting,
                    update: None,
                }),
                ready_update: Mutex::new(None),
                flow: Mutex::new(None),
                starting: AtomicBool::new(false),
                device_code: Mutex::new(None),
                verification_url: Mutex::new(None),
                pending_link: Mutex::new(None),
                tray: Mutex::new(None),
            });
            let tray = tray::build(&handle, &companion.state().tray_label())?;
            *lock(&companion.tray) = Some(tray);
            app.manage(Arc::clone(&companion));
            create_windows(app)?;
            tauri::async_runtime::spawn(update::run(Arc::clone(&companion)));
            tauri::async_runtime::spawn(companion.resume());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing a window leaves the app running in the tray; Quit in the
            // tray menu is the only way out.
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Someone looking at the local connections may just have
                // started OBS.
                WindowEvent::Focused(true) if window.label() == COMPANION_WINDOW => {
                    if let Some(companion) = window.try_state::<Arc<Companion>>() {
                        companion.integrations.rediscover();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(woofx3_companion_core::with_command_names!(command_handler))
        .build(tauri::generate_context!())
        .expect("error while building the Tauri app")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event {
                stop_engine_before_exit(app, &api, code);
            }
        });
}

/// Builds the windows the Tauri config declares, each with `create: false`.
/// Tauri would otherwise open them before the setup hook runs, and a page's
/// first command could arrive before `Companion` is managed, which fails it.
fn create_windows(app: &tauri::App) -> tauri::Result<()> {
    for window in &app.config().app.windows {
        WebviewWindowBuilder::from_config(app.handle(), window)?.build()?;
    }
    Ok(())
}

/// The local engine the host configuration asks for, started. An invalid
/// configuration, or a release with no orchestrator, is an error the caller
/// shows before exiting.
fn start_local_engine(
    app: &tauri::App,
    config: &HostConfig,
    credentials: &Credentials,
) -> anyhow::Result<LocalEngine> {
    match &config.mode {
        HostMode::Companion => Ok(LocalEngine::Off),
        HostMode::Local(settings) => Ok(LocalEngine::start(
            settings,
            &app.path().resource_dir()?,
            &app.path().app_local_data_dir()?,
            Arc::new(credentials.engine_client_store()),
            Arc::new(app.handle().clone()),
        )?),
    }
}

/// The host configuration file's path, and what it chooses.
fn load_host_config(app: &tauri::App) -> anyhow::Result<(std::path::PathBuf, HostConfig)> {
    let path = app.path().app_config_dir()?.join(HOST_CONFIG_FILE);
    let config = HostConfig::load(&path, default_host_mode())?;
    Ok((path, config))
}

/// The mode without a host configuration file: a build that bundles an engine
/// runs it, and the companion build runs none.
fn default_host_mode() -> HostMode {
    if cfg!(feature = "bundled-engine") {
        HostMode::Local(LocalEngineSettings::default())
    } else {
        HostMode::Companion
    }
}

/// Holds a quit until the local engine has stopped, so its services shut
/// down in order rather than being cut off, then quits with the same code.
/// A restart cannot be held (Tauri ignores `prevent_exit` for it), which is
/// why installing an update stops the engine before it restarts.
fn stop_engine_before_exit(app: &AppHandle, api: &tauri::ExitRequestApi, code: Option<i32>) {
    let Some(companion) = app.try_state::<Arc<Companion>>() else {
        return;
    };
    if !companion.engine.must_stop_before_exit() {
        return;
    }
    api.prevent_exit();
    let companion = Arc::clone(companion.inner());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        companion.engine.stop().await;
        app.exit(code.unwrap_or(0));
    });
}

#[cfg(test)]
mod tests {
    use woofx3_companion_core::window::{COMMAND_NAMES, DASHBOARD_COMMAND_NAMES};

    use super::convex_url::check_convex_url;

    /// The `allow-` permissions a capability file grants, and its windows.
    fn granted(capability: &str) -> (Vec<String>, serde_json::Value) {
        let capability: serde_json::Value = serde_json::from_str(capability).expect("valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("a permission list")
            .iter()
            .map(|permission| permission.as_str().expect("a permission id"))
            .filter(|permission| permission.starts_with("allow-"))
            .map(str::to_string)
            .collect();
        (permissions, capability["windows"].clone())
    }

    fn permission(name: &str) -> String {
        format!("allow-{}", name.replace('_', "-"))
    }

    #[test]
    fn test_capabilities_split_the_declared_commands_between_the_windows() {
        let (dashboard, dashboard_windows) =
            granted(include_str!("../capabilities/dashboard.json"));
        let (companion, companion_windows) =
            granted(include_str!("../capabilities/companion.json"));
        assert!(DASHBOARD_COMMAND_NAMES
            .iter()
            .all(|name| COMMAND_NAMES.contains(name)));
        let expected_dashboard: Vec<String> = DASHBOARD_COMMAND_NAMES
            .iter()
            .map(|name| permission(name))
            .collect();
        let expected_companion: Vec<String> = COMMAND_NAMES
            .iter()
            .filter(|name| !DASHBOARD_COMMAND_NAMES.contains(name))
            .map(|name| permission(name))
            .collect();
        assert_eq!(dashboard, expected_dashboard);
        assert_eq!(companion, expected_companion);
        assert_eq!(
            dashboard_windows,
            serde_json::json!([super::DASHBOARD_WINDOW])
        );
        assert_eq!(
            companion_windows,
            serde_json::json!([super::COMPANION_WINDOW])
        );
    }

    #[test]
    fn test_product_configs_leave_creating_windows_to_setup() {
        for config in [
            include_str!("../tauri.conf.json"),
            include_str!("../tauri.woofx3.conf.json"),
        ] {
            let config: serde_json::Value = serde_json::from_str(config).expect("valid JSON");
            let windows = config["app"]["windows"].as_array().expect("a window list");
            assert!(!windows.is_empty());
            for window in windows {
                assert_eq!(window["create"], serde_json::json!(false), "{window}");
            }
        }
    }

    #[test]
    fn test_check_convex_url_accepts_deployment_urls() {
        for url in [
            "https://happy-animal-123.convex.cloud",
            "http://127.0.0.1:3210",
            "https://convex.example.test/",
        ] {
            assert_eq!(check_convex_url(url), Ok(()), "{url}");
        }
    }

    #[test]
    fn test_check_convex_url_refuses_what_convex_cannot_connect_to() {
        for url in [
            "happy-animal-123.convex.cloud",
            "wss://happy-animal-123.convex.cloud",
            "ftp://example.test",
            "https://",
            " https://happy-animal-123.convex.cloud",
            "https://happy-animal-123.convex.cloud\n",
            "not a url",
        ] {
            assert!(check_convex_url(url).is_err(), "{url}");
        }
    }
}
