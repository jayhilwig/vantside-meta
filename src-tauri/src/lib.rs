mod career_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            career_store::load_career_memory,
            career_store::save_career_memory
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
