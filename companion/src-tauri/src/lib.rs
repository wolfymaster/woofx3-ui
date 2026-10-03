use tauri::Manager;

/// Placeholder: Connect to a woofx3 instance.
/// Will establish a WebSocket connection and bridge IPC ↔ woofx3 Cap'n RPC.
#[tauri::command]
fn connect_woofx3(url: String, api_key: Option<String>) -> Result<(), String> {
    // TODO: implement WebSocket connection to woofx3
    println!("[Tauri] connect_woofx3: url={url}, api_key={}", api_key.is_some());
    Ok(())
}

/// Placeholder: Disconnect from the current woofx3 instance.
#[tauri::command]
fn disconnect_woofx3() -> Result<(), String> {
    // TODO: close WebSocket connection
    println!("[Tauri] disconnect_woofx3");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![connect_woofx3, disconnect_woofx3])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
