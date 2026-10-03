//! The woofx3 companion: a tray app that pairs this computer with a woofx3
//! instance through the browser and stays connected to Convex. Its window
//! renders `CompanionState`; all work happens here, in Rust commands.
//!
//! Commands are async so none of them runs on the main thread: tray updates
//! (`MenuItem::set_text`) dispatch to the main thread and wait for it, so a
//! command blocking the main thread on a lock that a state update holds
//! would deadlock. Locks here are never held across a call into Tauri.

mod cloud;
mod credentials;
mod installation;
mod pairing;
mod state;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::async_runtime::JoinHandle;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent, Wry};

use cloud::Cloud;
use state::{CompanionState, STATE_EVENT};

/// Shared by the commands, the tray and the running flow.
pub struct Companion {
    app: AppHandle,
    cloud: Cloud,
    installation_id: String,
    state: Mutex<CompanionState>,
    /// The pairing attempt or paired session in progress. Starting another
    /// aborts it, so there is only ever one subscription set per token.
    flow: Mutex<Option<JoinHandle<()>>>,
    /// Set from a start request until its code is showing, so a double click
    /// cannot start two pairings.
    starting: AtomicBool,
    /// The pending pairing's device code, kept so cancelling can tell Convex.
    device_code: Mutex<Option<String>>,
    verification_url: Mutex<Option<String>>,
    tray_status: Mutex<Option<MenuItem<Wry>>>,
}

/// A poisoned lock only means another thread panicked mid-update; the data is
/// still a whole value, so keep going rather than take the tray down.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Companion {
    pub fn state(&self) -> CompanionState {
        lock(&self.state).clone()
    }

    /// Stores the state, pushes it to the window and refreshes the tray.
    pub fn set_state(&self, next: CompanionState) {
        let label = next.tray_label();
        *lock(&self.state) = next.clone();
        if let Err(err) = self.app.emit(STATE_EVENT, &next) {
            eprintln!("[companion] could not send state to the window: {err}");
        }
        let status = lock(&self.tray_status).clone();
        if let Some(status) = status {
            if let Err(err) = status.set_text(label) {
                eprintln!("[companion] could not update the tray: {err}");
            }
        }
    }

    /// Claims the right to start pairing: only from Unpaired or Error, and
    /// only once until the claim is released.
    fn try_begin_start(&self) -> bool {
        let state = lock(&self.state);
        if !matches!(
            *state,
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
async fn get_state(companion: State<'_, Arc<Companion>>) -> Result<CompanionState, String> {
    Ok(companion.state())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over to this one before it opens a
        // second Convex connection.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let cloud = tauri::async_runtime::block_on(Cloud::connect())?;
            let installation_id = installation::load_or_create(&app.path().app_data_dir()?)?;
            let companion = Arc::new(Companion {
                app: handle.clone(),
                cloud,
                installation_id,
                state: Mutex::new(CompanionState::Starting),
                flow: Mutex::new(None),
                starting: AtomicBool::new(false),
                device_code: Mutex::new(None),
                verification_url: Mutex::new(None),
                tray_status: Mutex::new(None),
            });
            let status = tray::build(&handle, &companion.state().tray_label())?;
            *lock(&companion.tray_status) = Some(status);
            app.manage(Arc::clone(&companion));
            tauri::async_runtime::spawn(companion.resume());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window leaves the companion running in the tray;
            // Quit in the tray menu is the only way out.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            start_pairing,
            cancel_pairing,
            open_verification_url,
            confirm_pairing,
            reject_pairing,
            unpair
        ])
        .run(tauri::generate_context!())
        .expect("error while running the woofx3 companion");
}
