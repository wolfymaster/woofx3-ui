use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{show_window, update, Companion, COMPANION_WINDOW, DASHBOARD_WINDOW};
use woofx3_companion_core::window::{ReadyUpdate, OPEN_LOCAL_CONNECTIONS_EVENT};

const OPEN_ID: &str = "open";
const CONNECTIONS_ID: &str = "connections";
const CONNECTION_STATUS_ID: &str = "connection-status";
const UPDATE_ID: &str = "update";
const QUIT_ID: &str = "quit";

/// Where the update item goes once there is one: after Open, Local
/// connections and the status line.
const UPDATE_POSITION: usize = 3;

/// The parts of the tray menu that change while the companion runs.
#[derive(Clone)]
pub struct Tray {
    menu: Menu<Wry>,
    /// The disabled status line, updated on every state change.
    pub status: MenuItem<Wry>,
    /// Built up front but only added to the menu once an update is ready, so
    /// the menu never shows an item that does nothing.
    update: MenuItem<Wry>,
}

impl Tray {
    /// Labels the update item with the ready version, adding it to the menu
    /// the first time.
    pub fn show_update(&self, ready: &ReadyUpdate) -> tauri::Result<()> {
        self.update.set_text(ready.tray_label())?;
        if self.menu.get(UPDATE_ID).is_none() {
            self.menu.insert(&self.update, UPDATE_POSITION)?;
        }
        Ok(())
    }
}

/// Builds the tray icon. "Open" is a menu item as well as a left click,
/// because Linux trays deliver no click events.
pub fn build(app: &AppHandle, initial_label: &str) -> tauri::Result<Tray> {
    let open = MenuItem::with_id(app, OPEN_ID, "Open woofx3", true, None::<&str>)?;
    let connections = MenuItem::with_id(
        app,
        CONNECTIONS_ID,
        "Local connections…",
        true,
        None::<&str>,
    )?;
    let connection_status = MenuItem::with_id(
        app,
        CONNECTION_STATUS_ID,
        "Connection status…",
        true,
        None::<&str>,
    )?;
    let status = MenuItem::with_id(app, "status", initial_label, false, None::<&str>)?;
    let update = MenuItem::with_id(app, UPDATE_ID, "Restart to update", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &connections,
            &connection_status,
            &status,
            &separator,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("./icons/32x32.png"))
        .tooltip("woofx3")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ID => show_window(app, DASHBOARD_WINDOW),
            CONNECTIONS_ID => {
                show_window(app, DASHBOARD_WINDOW);
                if let Err(err) = app.emit(OPEN_LOCAL_CONNECTIONS_EVENT, ()) {
                    eprintln!("[companion] could not open local connections: {err}");
                }
            }
            CONNECTION_STATUS_ID => show_window(app, COMPANION_WINDOW),
            UPDATE_ID => install_update(app),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle(), DASHBOARD_WINDOW);
            }
        })
        .build(app)?;

    Ok(Tray {
        menu,
        status,
        update,
    })
}

/// Menu events arrive on the main thread, which must stay free, so the
/// install runs on the async runtime. A failure leaves the update ready and
/// opens the window, whose banner offers it again.
fn install_update(app: &AppHandle) {
    let companion = Arc::clone(app.state::<Arc<Companion>>().inner());
    tauri::async_runtime::spawn(async move {
        if let Err(err) = update::install(&companion).await {
            eprintln!("[companion] {err}");
            companion.show_window();
        }
    });
}
