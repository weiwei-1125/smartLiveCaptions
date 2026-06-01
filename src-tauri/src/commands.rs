use crate::config::AppConfig;
use crate::openai::{transcription, translation};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, State};
use tokio::sync::mpsc;

pub struct AppState {
    pub config: AppConfig,
    pub http: reqwest::Client,
    pub audio_tx: Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
}

#[derive(Clone, Serialize)]
pub struct TranscriptPayload {
    pub kind: String, // "partial" | "final"
    pub text: String,
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
    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    *state.audio_tx.lock().unwrap() = Some(tx);
    let api_key = state.config.openai_api_key.clone();
    let model = state.config.transcription_model.clone();
    let app2 = app.clone();
    tokio::spawn(async move {
        let _ = transcription::connect(api_key, model, language, rx, move |ev| {
            let payload = match ev {
                transcription::TranscriptEvent::Partial(t) => Some(TranscriptPayload {
                    kind: "partial".into(),
                    text: t,
                }),
                transcription::TranscriptEvent::Final(t) => Some(TranscriptPayload {
                    kind: "final".into(),
                    text: t,
                }),
                transcription::TranscriptEvent::Other => None,
            };
            if let Some(p) = payload {
                let _ = app2.emit("transcript", p);
            }
        })
        .await;
    });
    Ok(())
}

#[tauri::command]
pub fn push_audio(state: State<AppState>, pcm: Vec<u8>) -> Result<(), String> {
    if let Some(tx) = state.audio_tx.lock().unwrap().as_ref() {
        tx.send(pcm)
            .map_err(|e| format!("audio send failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_transcription(state: State<AppState>) {
    *state.audio_tx.lock().unwrap() = None; // dropping the sender ends the connection loop
}
