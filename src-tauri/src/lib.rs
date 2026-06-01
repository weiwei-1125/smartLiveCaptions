pub mod config;
mod openai;
mod commands;

use commands::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg_path = std::path::Path::new("config.local.json");
    let config = config::load_from_file(cfg_path).unwrap_or_else(|e| {
        eprintln!("WARNING: {e}. Copy config.local.example.json to config.local.json and set your key.");
        config::AppConfig {
            openai_api_key: String::new(),
            translation_model: "gpt-4.1-nano".into(),
            transcription_model: "gpt-realtime-whisper".into(),
        }
    });

    let state = AppState {
        config,
        http: reqwest::Client::new(),
        audio_tx: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
