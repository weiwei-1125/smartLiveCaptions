use serde_json::Value;

#[derive(Debug, PartialEq, Clone)]
pub enum TranscriptEvent {
    Partial(String),
    Final(String),
    Error(String),
    Other,
}

/// Parse a raw server JSON message into a transcript event.
pub fn parse_event(msg: &Value) -> TranscriptEvent {
    match msg["type"].as_str() {
        Some("conversation.item.input_audio_transcription.delta") => {
            TranscriptEvent::Partial(msg["delta"].as_str().unwrap_or("").to_string())
        }
        Some("conversation.item.input_audio_transcription.completed") => {
            TranscriptEvent::Final(msg["transcript"].as_str().unwrap_or("").to_string())
        }
        Some("error") => {
            TranscriptEvent::Error(msg["error"]["message"].as_str().unwrap_or("unknown error").to_string())
        }
        _ => TranscriptEvent::Other,
    }
}

/// Build the GA `session.update` payload that configures a transcription session:
/// 24kHz mono PCM input (GA requires >=24kHz), the transcription model + language,
/// and server-side VAD so the server auto-segments utterances (delta + completed).
pub fn session_update(model: &str, language: &str) -> Value {
    serde_json::json!({
        "type": "session.update",
        "session": {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": { "type": "audio/pcm", "rate": 24000 },
                    "transcription": { "model": model, "language": language },
                    "turn_detection": { "type": "server_vad" }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_partial() {
        let e = parse_event(&json!({"type":"conversation.item.input_audio_transcription.delta","delta":"你"}));
        assert_eq!(e, TranscriptEvent::Partial("你".into()));
    }

    #[test]
    fn parses_final() {
        let e = parse_event(&json!({"type":"conversation.item.input_audio_transcription.completed","transcript":"你好"}));
        assert_eq!(e, TranscriptEvent::Final("你好".into()));
    }

    #[test]
    fn ignores_unknown() {
        assert_eq!(parse_event(&json!({"type":"session.created"})), TranscriptEvent::Other);
    }

    #[test]
    fn parses_error() {
        let e = parse_event(&json!({"type":"error","error":{"message":"bad model"}}));
        assert_eq!(e, TranscriptEvent::Error("bad model".into()));
    }

    #[test]
    fn session_update_sets_language_and_model() {
        let s = session_update("gpt-4o-transcribe", "zh");
        assert_eq!(s["type"], "session.update");
        assert_eq!(s["session"]["type"], "transcription");
        assert_eq!(s["session"]["audio"]["input"]["transcription"]["language"], "zh");
        assert_eq!(s["session"]["audio"]["input"]["transcription"]["model"], "gpt-4o-transcribe");
    }
}

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use base64::Engine;

/// Spawn the realtime transcription connection. Calls `on_event` for each parsed event.
pub async fn connect(
    api_key: String,
    model: String,
    language: String,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    on_event: impl Fn(TranscriptEvent) + Send + 'static,
) -> Result<(), String> {
    let mut req = "wss://api.openai.com/v1/realtime?intent=transcription"
        .into_client_request()
        .map_err(|e| format!("bad ws request: {e}"))?;
    let auth = format!("Bearer {api_key}")
        .parse()
        .map_err(|e| format!("invalid api_key header: {e}"))?;
    req.headers_mut().insert("Authorization", auth);
    // NOTE: GA Realtime API — do NOT send the OpenAI-Beta header (it forces the
    // removed beta shape and is rejected with `beta_api_shape_disabled`).

    let (ws, _) = tokio_tungstenite::connect_async(req).await.map_err(|e| format!("ws connect failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(session_update(&model, &language).to_string()))
        .await
        .map_err(|e| format!("session update failed: {e}"))?;

    // Forward audio frames as input_audio_buffer.append events.
    let audio_task = tokio::spawn(async move {
        while let Some(pcm) = audio_rx.recv().await {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&pcm);
            let msg = serde_json::json!({ "type": "input_audio_buffer.append", "audio": b64 }).to_string();
            if write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Read server events.
    eprintln!("[ws] connected; sent session_update (model={model}, language={language})");
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(txt)) => {
                // Full raw dump only when SLC_DEBUG_WS is set; otherwise stay quiet
                // (error frames are surfaced via TranscriptEvent::Error below).
                if std::env::var("SLC_DEBUG_WS").is_ok() {
                    eprintln!("[ws-recv] {txt}");
                }
                if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                    on_event(parse_event(&v));
                }
            }
            Ok(_) => {}
            Err(e) => {
                eprintln!("[ws-err] {e}");
                break;
            }
        }
    }
    audio_task.abort();
    Ok(())
}
