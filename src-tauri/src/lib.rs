mod career_store;

use tauri::Manager;

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
