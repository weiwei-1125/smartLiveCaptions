use serde_json::Value;

#[derive(Debug, PartialEq, Clone)]
pub enum TranscriptEvent {
    Partial(String),
    Final(String),
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
        _ => TranscriptEvent::Other,
    }
}

/// Build the session.update payload that configures language + audio format.
pub fn session_update(model: &str, language: &str) -> Value {
    serde_json::json!({
        "type": "transcription_session.update",
        "session": {
            "input_audio_format": "pcm16",
            "input_audio_transcription": { "model": model, "language": language },
            "turn_detection": { "type": "server_vad" }
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
    fn session_update_sets_language_and_model() {
        let s = session_update("gpt-realtime-whisper", "zh");
        assert_eq!(s["session"]["input_audio_transcription"]["language"], "zh");
        assert_eq!(s["session"]["input_audio_transcription"]["model"], "gpt-realtime-whisper");
    }
}

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use base64::Engine;

/// A handle to push PCM16 audio into the live transcription stream.
pub struct TranscriptionHandle {
    pub audio_tx: mpsc::UnboundedSender<Vec<u8>>, // raw PCM16 little-endian bytes
}

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
    req.headers_mut().insert("Authorization", format!("Bearer {api_key}").parse().unwrap());
    req.headers_mut().insert("OpenAI-Beta", "realtime=v1".parse().unwrap());

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
    while let Some(Ok(msg)) = read.next().await {
        if let Message::Text(txt) = msg {
            if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                on_event(parse_event(&v));
            }
        }
    }
    audio_task.abort();
    Ok(())
}
