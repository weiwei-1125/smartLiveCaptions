pub mod config;
mod openai;
mod commands;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg_path = std::path::Path::new("config.local.json");
    let config = config::load_from_file(cfg_path).unwrap_or_else(|e| {
        eprintln!("WARNING: {e}. Copy config.local.example.json to config.local.json and set your key.");
        config::AppConfig {
            openai_api_key: String::new(),
            translation_model: "gpt-4.1-nano".into(),
            transcription_model: "gpt-4o-transcribe".into(),
        }
    });

    let state = AppState {
        config,
        http: reqwest::Client::new(),
        audio_tx: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Dock the overlay near the bottom-center of the primary monitor on launch.
            // work_area() excludes the taskbar (unlike monitor.size()/position()).
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = win.primary_monitor() {
                    let work = monitor.work_area();
                    let wsize = win.outer_size().unwrap_or(work.size);
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let margin = (12.0 * scale).round() as i32; // gap above taskbar
                    let x = work.position.x + ((work.size.width as i32 - wsize.width as i32) / 2).max(0);
                    let y = work.position.y + work.size.height as i32 - wsize.height as i32 - margin;
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::translate,
            commands::start_transcription,
            commands::push_audio,
            commands::stop_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
