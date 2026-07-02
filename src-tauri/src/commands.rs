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
    /// Polish generation — deliberately SEPARATE from `gen`: transcription reconnects
    /// (pace change, settings save, auto-reconnect) must NOT kill in-flight polish streams,
    /// whose target blocks survive reconnects. Bumped only by begin_polish_session (once per
    /// webview lifetime), which guards a reloaded webview reusing caption ids from 1.
    pub polish_gen: Arc<AtomicU64>,
    /// Shared HTTP client for the polish step — keeps connections pooled/warm so each
    /// per-sentence call skips the TLS handshake (a cold handshake costs 2-3x RTT).
    pub http: reqwest::Client,
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

/// True when an OpenAI (polish) key is configured — the colloquial-English line is on.
#[tauri::command]
pub fn has_llm_key(state: State<AppState>) -> bool {
    !read_config(&state).openai_api_key.trim().is_empty()
}

/// The currently configured OpenAI polish key, so the settings panel can prefill it.
#[tauri::command]
pub fn get_llm_key(state: State<AppState>) -> String {
    read_config(&state).openai_api_key
}

/// Persist the user's own OpenAI polish key ("" clears it → feature off) and apply it live.
/// Never bundled — same per-user config file as the Soniox key. Persists BEFORE mutating
/// memory: if the disk write fails, a key the user believes cleared must not silently come
/// back on next launch and resume uploading their speech.
#[tauri::command]
pub fn set_llm_key(app: tauri::AppHandle, state: State<AppState>, key: String) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?
        .join("config.json");
    let new_cfg = {
        let mut cfg = read_config(&state);
        cfg.openai_api_key = key.trim().to_string();
        cfg
    };
    crate::config::save_to_file(&path, &new_cfg)?;
    let mut cfg = state.config.write().unwrap_or_else(|p| p.into_inner());
    *cfg = new_cfg;
    Ok(())
}

/// Start a polish session for this webview lifetime. Invalidates any polish stream from a
/// PREVIOUS webview (a reload resets caption ids to 1 while Rust tasks keep running — without
/// this, an old stream could attach to a reused id). Ordinary reconnects don't touch this.
#[tauri::command]
pub fn begin_polish_session(state: State<AppState>) {
    state.polish_gen.fetch_add(1, Ordering::SeqCst);
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

/// Stream a colloquial-English rewrite for a committed caption sentence (`id` = the caption
/// block the frontend attaches the text to). Emits polish_delta {id,text} per chunk, then
/// polish_done {id} / polish_error {id,msg}. No-op when no polish key is configured.
#[tauri::command]
pub async fn polish_sentence(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: u64,
    source: String,
    draft: String,
) -> Result<(), String> {
    let cfg = read_config(&state);
    let key = cfg.openai_api_key.trim().to_string();
    if key.is_empty() {
        return Ok(()); // feature off
    }
    // Gate on polish_gen (NOT the transcription `gen`): committed blocks survive reconnects,
    // so an in-flight rewrite must keep streaming across them. polish_gen changes only when
    // the webview reloads (caption ids reset → stale streams must not attach to reused ids).
    let my_gen = state.polish_gen.load(Ordering::SeqCst);
    let gen_delta = state.polish_gen.clone();
    let gen_result = state.polish_gen.clone();
    let client = state.http.clone();
    let app_result = app.clone();
    tokio::spawn(async move {
        let result = crate::polish::polish_stream(
            &client,
            &cfg.llm_base_url,
            &key,
            &cfg.llm_model,
            &source,
            &draft,
            move |delta| {
                if gen_delta.load(Ordering::SeqCst) != my_gen {
                    return; // superseded session — drop
                }
                let _ = app.emit("polish_delta", serde_json::json!({ "id": id, "text": delta }));
            },
        )
        .await;
        if gen_result.load(Ordering::SeqCst) != my_gen {
            return;
        }
        match result {
            Ok(()) => {
                let _ = app_result.emit("polish_done", serde_json::json!({ "id": id }));
            }
            Err(e) => {
                eprintln!("[polish] {e}");
                let _ = app_result.emit("polish_error", serde_json::json!({ "id": id, "msg": e }));
            }
        }
    });
    Ok(())
}
