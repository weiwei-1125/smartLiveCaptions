pub mod config;
mod soniox;
mod polish;
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
            if !cfg.soniox_api_key.trim().is_empty() {
                return cfg;
            }
        }
    }
    if let Ok(cfg) = config::load_from_file(std::path::Path::new("config.local.json")) {
        return cfg;
    }
    config::AppConfig::keyless()
}

// Overlay's intended LOGICAL window size — keep in sync with tauri.conf.json (app.windows[0]).
const OVERLAY_W: f64 = 780.0;
const OVERLAY_H: f64 = 460.0;

/// Size the overlay to its intended LOGICAL size, then dock it bottom-center above the taskbar
/// of the primary monitor. Setting a LOGICAL size (not physical) is what makes this correct on
/// a mixed-DPI multi-monitor setup: Windows preserves a window's *logical* size across a
/// cross-DPI move, so 780x460 logical lands at the right physical size on the primary no matter
/// which monitor's scale the window was born in. (Setting a physical size computed for one
/// monitor is the bug — it gets rescaled by the DPI ratio when the window moves.)
fn place_overlay<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let scale = monitor.scale_factor(); // primary's scale, used only to place the window
        let work = monitor.work_area();
        let _ = win.set_size(tauri::LogicalSize::new(OVERLAY_W, OVERLAY_H));
        // Position uses the size the window WILL have at the primary's scale.
        let pw = (OVERLAY_W * scale).round() as i32;
        let ph = (OVERLAY_H * scale).round() as i32;
        let margin = (12.0 * scale).round() as i32; // gap above taskbar
        let x = work.position.x + ((work.size.width as i32 - pw) / 2).max(0);
        let y = (work.position.y + work.size.height as i32 - ph - margin).max(work.position.y);
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        config: RwLock::new(config::AppConfig::keyless()),
        audio_tx: Mutex::new(None),
        gen: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        polish_gen: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        // Bounded timeouts so a black-holed connection (sleep/wake, VPN drop) fails into
        // polish_error instead of leaking a task per sentence; a rewrite finishes in ~2s.
        http: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default(),
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

            // Size + dock the overlay on the primary monitor. On a mixed-DPI multi-monitor setup,
            // a window launched from a shortcut on a different-scale monitor is born in that
            // monitor's DPI; place_overlay sets a LOGICAL size, which Windows preserves across the
            // cross-DPI move so it lands correctly on the primary. The event handler re-asserts the
            // logical size if it still drifts as the window settles (Resized/Moved/ScaleFactorChanged
            // fire unpredictably during the move); checking logical size works at any scale. Capped,
            // and stops once correct, so it never fights the user resizing the window later.
            if let Some(win) = app.get_webview_window("main") {
                place_overlay(&win);
                let win2 = win.clone();
                let done = std::sync::atomic::AtomicBool::new(false);
                let tries = std::sync::atomic::AtomicU32::new(0);
                win.on_window_event(move |ev| {
                    use std::sync::atomic::Ordering::SeqCst;
                    if done.load(SeqCst) {
                        return;
                    }
                    if !matches!(
                        ev,
                        tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::Moved(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. }
                    ) {
                        return;
                    }
                    let scale = win2.scale_factor().unwrap_or(1.0);
                    if let Ok(cur) = win2.inner_size() {
                        let lw = cur.width as f64 / scale;
                        let lh = cur.height as f64 / scale;
                        if (lw - OVERLAY_W).abs() <= 2.0 && (lh - OVERLAY_H).abs() <= 2.0 {
                            done.store(true, SeqCst);
                        } else if tries.fetch_add(1, SeqCst) < 8 {
                            place_overlay(&win2);
                        } else {
                            done.store(true, SeqCst);
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::get_api_key,
            commands::set_api_key,
            commands::has_llm_key,
            commands::get_llm_key,
            commands::set_llm_key,
            commands::begin_polish_session,
            commands::get_hotkey,
            commands::set_hotkey,
            commands::start_transcription,
            commands::push_audio,
            commands::stop_transcription,
            commands::polish_sentence
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
