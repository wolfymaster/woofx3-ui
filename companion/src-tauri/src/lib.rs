//! The woofx3 companion: a tray app that pairs this computer with a woofx3
//! instance through the browser and stays connected to Convex. Its window
//! renders `WindowState`; all work happens here, in Rust commands.
//!
//! Commands are async so none of them runs on the main thread: tray updates
//! (`MenuItem::set_text`) dispatch to the main thread and wait for it, so a
//! command blocking the main thread on a lock that a state update holds
//! would deadlock. Locks here are never held across a call into Tauri.

mod cloud;
mod credentials;
mod installation;
mod integration_store;
mod integrations;
mod pairing;
mod state;
mod tray;
mod update;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use cloud::Cloud;
use integrations::Integrations;
use state::{CompanionState, IntegrationsView, ReadyUpdate, TestResult, WindowState, STATE_EVENT};
use tray::Tray;
use update::Downloaded;

/// Shared by the commands, the tray and the running flow.
pub struct Companion {
    app: AppHandle,
    cloud: Cloud,
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

    pub fn show_window(&self) {
        show_main_window(&self.app);
    }

    /// Picks up where the last run left off, from the stored token.
    async fn resume(self: Arc<Self>) {
        match credentials::load().await {
            Ok(None) => {
                self.set_state(CompanionState::Unpaired);
                self.show_window();
            }
            Ok(Some(stored)) => {
                if !stored.confirmed {
                    self.show_window();
                }
                let session = tauri::async_runtime::spawn(pairing::run_session(
                    Arc::clone(&self),
                    stored.token,
                    stored.confirmed,
                    stored.instance_name,
                ));
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
        let token = credentials::load()
            .await
            .map_err(|err| format!("{err:#}"))?
            .map(|stored| stored.token);
        pairing::forget_and_unpair(self, token, device_code).await;
        Ok(())
    }
}

pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
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
    update::install(&companion).inspect_err(|err| eprintln!("[companion] {err}"))
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
    module_id: String,
    endpoint_id: String,
    enabled: bool,
) -> Result<(), String> {
    companion
        .integrations
        .set_enabled(&module_id, &endpoint_id, enabled)
        .await
}

/// The streamer typed `host:port` and pressed Confirm address.
#[tauri::command]
async fn confirm_address(
    companion: State<'_, Arc<Companion>>,
    module_id: String,
    endpoint_id: String,
    address: String,
) -> Result<(), String> {
    companion
        .integrations
        .confirm_address(&module_id, &endpoint_id, &address)
        .await
}

#[tauri::command]
async fn use_discovered(
    companion: State<'_, Arc<Companion>>,
    module_id: String,
    endpoint_id: String,
) -> Result<(), String> {
    companion
        .integrations
        .use_discovered(&module_id, &endpoint_id)
        .await
}

#[tauri::command]
async fn set_share_password(
    companion: State<'_, Arc<Companion>>,
    module_id: String,
    endpoint_id: String,
    share: bool,
) -> Result<(), String> {
    companion
        .integrations
        .set_share_password(&module_id, &endpoint_id, share)
        .await
}

#[tauri::command]
async fn test_endpoint(
    companion: State<'_, Arc<Companion>>,
    module_id: String,
    endpoint_id: String,
) -> Result<TestResult, String> {
    companion.integrations.test(&module_id, &endpoint_id).await
}

/// Connects to the relay again after another connection displaced this one
/// or woofx3 refused a credential.
#[tauri::command]
async fn reconnect_relay(companion: State<'_, Arc<Companion>>) -> Result<(), String> {
    companion.integrations.reconnect_relay();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over to this one before it opens a
        // second Convex connection.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let cloud = tauri::async_runtime::block_on(Cloud::connect())?;
            let app_data_dir = app.path().app_data_dir()?;
            let installation_id = installation::load_or_create(&app_data_dir)?;
            let integrations = Arc::new(Integrations::new(
                handle.clone(),
                cloud.clone(),
                &app_data_dir,
                app.path().config_dir().ok(),
            ));
            let companion = Arc::new(Companion {
                app: handle.clone(),
                cloud,
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
                tray: Mutex::new(None),
            });
            let tray = tray::build(&handle, &companion.state().tray_label())?;
            *lock(&companion.tray) = Some(tray);
            app.manage(Arc::clone(&companion));
            tauri::async_runtime::spawn(update::run(Arc::clone(&companion)));
            tauri::async_runtime::spawn(companion.resume());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window leaves the companion running in the tray;
            // Quit in the tray menu is the only way out.
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Someone looking at the window may just have started OBS.
                WindowEvent::Focused(true) => {
                    if let Some(companion) = window.try_state::<Arc<Companion>>() {
                        companion.integrations.rediscover();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            start_pairing,
            cancel_pairing,
            open_verification_url,
            confirm_pairing,
            reject_pairing,
            unpair,
            install_update,
            get_integrations,
            set_endpoint_enabled,
            confirm_address,
            use_discovered,
            set_share_password,
            test_endpoint,
            reconnect_relay
        ])
        .run(tauri::generate_context!())
        .expect("error while running the woofx3 companion");
}
