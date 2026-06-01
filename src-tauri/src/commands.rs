use crate::config::AppConfig;
use crate::openai::{transcription, translation};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use tokio::sync::mpsc;

pub struct AppState {
    pub config: AppConfig,
    pub http: reqwest::Client,
    pub audio_tx: Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    /// Monotonic session generation. Bumped on every start/stop so events from a
    /// superseded transcription session (e.g. after a mode switch) are dropped
    /// instead of being misclassified under the new mode.
    pub gen: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
pub struct TranscriptPayload {
    pub kind: String, // "partial" | "final"
    pub text: String,
}

/// Lock the audio sender, tolerating a poisoned mutex instead of panicking.
fn lock_tx(
    state: &AppState,
) -> std::sync::MutexGuard<'_, Option<mpsc::UnboundedSender<Vec<u8>>>> {
    state.audio_tx.lock().unwrap_or_else(|p| p.into_inner())
}

#[tauri::command]
pub fn has_api_key(state: State<AppState>) -> bool {
    !state.config.openai_api_key.trim().is_empty()
}

#[tauri::command]
pub async fn translate(state: State<'_, AppState>, prompt: String) -> Result<String, String> {
    translation::translate(
        &state.http,
        &state.config.openai_api_key,
        &state.config.translation_model,
        &prompt,
    )
    .await
}

#[tauri::command]
pub async fn start_transcription(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    language: String,
) -> Result<(), String> {
    // This start supersedes any previous session.
    let my_gen = state.gen.fetch_add(1, Ordering::SeqCst) + 1;
    let gen_emit = state.gen.clone();
    let gen_result = state.gen.clone();

    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    *lock_tx(&state) = Some(tx);
    let api_key = state.config.openai_api_key.clone();
    let model = state.config.transcription_model.clone();
    let app2 = app.clone();
    let app_err = app.clone();
    tokio::spawn(async move {
        let result = transcription::connect(api_key, model, language, rx, move |ev| {
            // Drop events from a superseded session.
            if gen_emit.load(Ordering::SeqCst) != my_gen {
                return;
            }
            let payload = match ev {
                transcription::TranscriptEvent::Partial(t) => Some(TranscriptPayload {
                    kind: "partial".into(),
                    text: t,
                }),
                transcription::TranscriptEvent::Final(t) => Some(TranscriptPayload {
                    kind: "final".into(),
                    text: t,
                }),
                transcription::TranscriptEvent::Error(e) => {
                    eprintln!("[ws-error] {e}");
                    let _ = app2.emit("conn_error", e);
                    None
                }
                transcription::TranscriptEvent::Other => None,
            };
            if let Some(p) = payload {
                let _ = app2.emit("transcript", p);
            }
        })
        .await;
        // Only report the outcome if this session is still the active one.
        if gen_result.load(Ordering::SeqCst) == my_gen {
            match result {
                Err(e) => {
                    eprintln!("[conn] transcription connect failed: {e}");
                    let _ = app_err.emit("conn_error", e);
                }
                Ok(()) => eprintln!("[conn] transcription connection closed"),
            }
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
