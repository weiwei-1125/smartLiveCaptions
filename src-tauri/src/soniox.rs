// Soniox real-time STT WebSocket client. Streams raw PCM up and forwards Soniox's
// token-result messages (final/non-final + translation) to the caller. The key stays in
// Rust (never reaches the webview), so no temporary key is needed — Rust is the trusted client.
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

const WS_URL: &str = "wss://stt-rt.soniox.com/transcribe-websocket";
const MODEL: &str = "stt-rt-v4";

#[derive(Debug, Clone)]
pub enum SonioxEvent {
    Open,           // WS connected + config sent → link is live
    Result(Value),  // a token-result message (forwarded raw to the frontend)
    Error(String),  // a server error message
}

/// The first JSON message: auth + model + 24kHz mono PCM + bilingual zh/en + two-way
/// zh<->en translation + sentence endpoint detection. `endpoint_delay_ms` (500–3000) is the
/// max wait after speech ends before a sentence boundary (<end>) — the user-tunable "断句节奏"
/// (lower = snappier/more fragments, higher = waits for complete sentences).
pub fn session_config(api_key: &str, endpoint_delay_ms: u32) -> Value {
    serde_json::json!({
        "api_key": api_key,
        "model": MODEL,
        "audio_format": "pcm_s16le",
        "sample_rate": 24000,
        "num_channels": 1,
        "language_hints": ["zh", "en"],
        "enable_language_identification": true,
        "enable_endpoint_detection": true,
        "max_endpoint_delay_ms": endpoint_delay_ms.clamp(500, 3000),
        "translation": { "type": "two_way", "language_a": "zh", "language_b": "en" }
    })
}

/// Open the Soniox stream. Calls `on_event` for Open / each Result / Error. Returns when
/// the connection ends (the caller treats that as a disconnect to auto-reconnect).
pub async fn connect(
    api_key: String,
    endpoint_delay_ms: u32,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    on_event: impl Fn(SonioxEvent) + Send + 'static,
) -> Result<(), String> {
    let req = WS_URL
        .into_client_request()
        .map_err(|e| format!("bad ws request: {e}"))?;
    let (ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("ws connect failed: {e}"))?;
    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(session_config(&api_key, endpoint_delay_ms).to_string()))
        .await
        .map_err(|e| format!("config send failed: {e}"))?;
    on_event(SonioxEvent::Open);

    // Forward audio as raw binary PCM frames; when the channel closes, send an empty frame
    // to signal end-of-audio so the server flushes the final tokens.
    let audio_task = tokio::spawn(async move {
        while let Some(pcm) = audio_rx.recv().await {
            if write.send(Message::Binary(pcm)).await.is_err() {
                return;
            }
        }
        let _ = write.send(Message::Text(String::new())).await;
    });

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(txt)) => {
                if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                    let has_err = !v["error_code"].is_null() || v["error_message"].is_string();
                    if has_err {
                        let code = v["error_code"].to_string();
                        let m = v["error_message"].as_str().unwrap_or("").to_string();
                        on_event(SonioxEvent::Error(format!("{code} {m}").trim().to_string()));
                    } else {
                        on_event(SonioxEvent::Result(v));
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(e) => {
                eprintln!("[soniox ws-err] {e}");
                break;
            }
        }
    }
    audio_task.abort();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_config_has_expected_shape() {
        let c = session_config("sk-abc", 2000);
        assert_eq!(c["api_key"], "sk-abc");
        assert_eq!(c["model"], "stt-rt-v4");
        assert_eq!(c["audio_format"], "pcm_s16le");
        assert_eq!(c["sample_rate"], 24000);
        assert_eq!(c["num_channels"], 1);
        assert_eq!(c["enable_endpoint_detection"], true);
        assert_eq!(c["max_endpoint_delay_ms"], 2000);
        assert_eq!(c["translation"]["type"], "two_way");
        assert_eq!(c["translation"]["language_a"], "zh");
        assert_eq!(c["translation"]["language_b"], "en");
    }

    #[test]
    fn endpoint_delay_is_clamped() {
        assert_eq!(session_config("k", 100)["max_endpoint_delay_ms"], 500);
        assert_eq!(session_config("k", 9000)["max_endpoint_delay_ms"], 3000);
    }
}
