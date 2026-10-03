use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::show_main_window;

const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";

/// Builds the tray icon and returns the disabled status line, which the
/// caller updates on every state change. "Open" is a menu item as well as a
/// left click, because Linux trays deliver no click events.
pub fn build(app: &AppHandle, initial_label: &str) -> tauri::Result<MenuItem<Wry>> {
    let open = MenuItem::with_id(app, OPEN_ID, "Open woofx3 companion", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", initial_label, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &status, &separator, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(tauri::include_image!("./icons/32x32.png"))
        .tooltip("woofx3 companion")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ID => show_main_window(app),
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
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(status)
}
