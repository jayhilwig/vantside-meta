mod career_store;

use tauri::Manager;

#[tauri::command]
fn read_local_api_token(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<String, String> {
    if window.label() != "main" { return Err("Local API access is unavailable in this window.".into()); }
    let path = app.path().app_local_data_dir().map_err(|_| "App data is unavailable.")?.join("local-api-token");
    let token = std::fs::read_to_string(path).map_err(|_| "Start the local backend, then try again.")?;
    let token = token.trim();
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Local API authorization needs repair.".into());
    }
    Ok(token.to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("icons/128x128.png"))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_local_api_token,
            career_store::load_career_memory,
            career_store::save_career_memory
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(hud) = window.app_handle().get_webview_window("hud") {
                    let _ = hud.close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
