pub mod config;
mod openai;
mod commands;

use commands::AppState;
use std::sync::{Mutex, RwLock};
use tauri::Manager;

/// Resolve the config at startup. Priority:
///   1. The per-user saved config (where the settings panel writes the user's own key).
///   2. A dev-only `config.local.json` fallback — gitignored and NOT in bundle resources,
///      so it exists only when running `tauri dev`, never in a shipped installer.
///   3. A key-less default, so a fresh install starts empty and prompts for a key.
/// This guarantees a distributed build ships with NO key baked in.
fn load_startup_config(app: &tauri::App) -> config::AppConfig {
    if let Ok(dir) = app.path().app_config_dir() {
        if let Ok(cfg) = config::load_from_file(&dir.join("config.json")) {
            if !cfg.openai_api_key.trim().is_empty() {
                return cfg;
            }
        }
    }
    if let Ok(cfg) = config::load_from_file(std::path::Path::new("config.local.json")) {
        return cfg;
    }
    config::AppConfig::keyless()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        config: RwLock::new(config::AppConfig::keyless()),
        http: reqwest::Client::new(),
        audio_tx: Mutex::new(None),
        gen: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .setup(|app| {
            // Load the persisted/dev/keyless key into the managed config.
            let cfg = load_startup_config(app);
            if let Ok(mut guard) = app.state::<AppState>().config.write() {
                *guard = cfg;
            }

            // Dock the overlay near the bottom-center of the primary monitor on launch.
            // work_area() excludes the taskbar (unlike monitor.size()/position()).
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = win.primary_monitor() {
                    let work = monitor.work_area();
                    let wsize = win.outer_size().unwrap_or(work.size);
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let margin = (12.0 * scale).round() as i32; // gap above taskbar
                    let x = work.position.x + ((work.size.width as i32 - wsize.width as i32) / 2).max(0);
                    let y = (work.position.y + work.size.height as i32 - wsize.height as i32 - margin)
                        .max(work.position.y); // never clip above the work area on small screens
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::get_api_key,
            commands::set_api_key,
            commands::get_hotkey,
            commands::set_hotkey,
            commands::translate,
            commands::start_transcription,
            commands::push_audio,
            commands::stop_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
