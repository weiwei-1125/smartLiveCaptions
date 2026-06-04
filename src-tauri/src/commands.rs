use crate::config::AppConfig;
use crate::soniox;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager, State};
use tokio::sync::mpsc;

pub struct AppState {
    /// Mutable so the user can set/change their API key at runtime (settings panel).
    /// Reads clone the field they need; writes go through `set_api_key`.
    pub config: RwLock<AppConfig>,
    pub audio_tx: Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    /// Monotonic session generation. Bumped on every start/stop so events from a
    /// superseded session are dropped instead of leaking into the next one.
    pub gen: Arc<AtomicU64>,
}

/// Read a clone of the current config, tolerating a poisoned lock instead of panicking.
fn read_config(state: &AppState) -> AppConfig {
    state.config.read().unwrap_or_else(|p| p.into_inner()).clone()
}

/// Lock the audio sender, tolerating a poisoned mutex instead of panicking.
fn lock_tx(
    state: &AppState,
) -> std::sync::MutexGuard<'_, Option<mpsc::UnboundedSender<Vec<u8>>>> {
    state.audio_tx.lock().unwrap_or_else(|p| p.into_inner())
}

#[tauri::command]
pub fn has_api_key(state: State<AppState>) -> bool {
    !read_config(&state).soniox_api_key.trim().is_empty()
}

/// The currently configured Soniox key, so the settings panel can prefill it (masked).
#[tauri::command]
pub fn get_api_key(state: State<AppState>) -> String {
    read_config(&state).soniox_api_key
}

/// Persist the user's own Soniox key to the per-user app config dir and apply it live.
/// The key is NEVER bundled — a fresh install starts key-less until the user sets it here.
#[tauri::command]
pub fn set_api_key(app: tauri::AppHandle, state: State<AppState>, key: String) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?
        .join("config.json");
    let new_cfg = {
        let mut cfg = state.config.write().unwrap_or_else(|p| p.into_inner());
        cfg.soniox_api_key = key.trim().to_string();
        cfg.clone()
    };
    crate::config::save_to_file(&path, &new_cfg)
}

/// The saved opt-in global mute hotkey accelerator ("" = none).
#[tauri::command]
pub fn get_hotkey(state: State<AppState>) -> String {
    read_config(&state).mute_hotkey
}

/// Persist the chosen global mute hotkey (or "" to clear it). Registration happens in the
/// frontend via the global-shortcut plugin; this only stores the choice.
#[tauri::command]
pub fn set_hotkey(app: tauri::AppHandle, state: State<AppState>, hotkey: String) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?
        .join("config.json");
    let new_cfg = {
        let mut cfg = state.config.write().unwrap_or_else(|p| p.into_inner());
        cfg.mute_hotkey = hotkey.trim().to_string();
        cfg.clone()
    };
    crate::config::save_to_file(&path, &new_cfg)
}

#[tauri::command]
pub async fn start_transcription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    endpoint_delay_ms: u32,
) -> Result<(), String> {
    // This start supersedes any previous session.
    let my_gen = state.gen.fetch_add(1, Ordering::SeqCst) + 1;
    let gen_emit = state.gen.clone();
    let gen_result = state.gen.clone();

    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    *lock_tx(&state) = Some(tx);
    let api_key = read_config(&state).soniox_api_key;
    let app2 = app.clone();
    let app_err = app.clone();
    tokio::spawn(async move {
        let result = soniox::connect(api_key, endpoint_delay_ms, rx, move |ev| {
            if gen_emit.load(Ordering::SeqCst) != my_gen {
                return; // drop events from a superseded session
            }
            match ev {
                soniox::SonioxEvent::Open => {
                    let _ = app2.emit("conn_open", ()); // link live → UI confirms / resets reconnect
                }
                soniox::SonioxEvent::Result(v) => {
                    let _ = app2.emit("soniox_result", v); // raw token-result JSON → frontend renders
                }
                soniox::SonioxEvent::Error(e) => {
                    eprintln!("[soniox-error] {e}");
                    let _ = app2.emit("conn_error", e);
                }
            }
        })
        .await;
        // Connection ended while still active → tell the UI to auto-reconnect.
        if gen_result.load(Ordering::SeqCst) == my_gen {
            match &result {
                Err(e) => eprintln!("[conn] soniox connect failed: {e}"),
                Ok(()) => eprintln!("[conn] soniox connection closed"),
            }
            let _ = app_err.emit("conn_lost", ());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn push_audio(state: State<AppState>, pcm: Vec<u8>) -> Result<(), String> {
    if let Some(tx) = lock_tx(&state).as_ref() {
        tx.send(pcm)
            .map_err(|e| format!("audio send failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_transcription(state: State<AppState>) {
    state.gen.fetch_add(1, Ordering::SeqCst); // invalidate the active session's events
    *lock_tx(&state) = None; // dropping the sender ends the audio-forward loop
}
