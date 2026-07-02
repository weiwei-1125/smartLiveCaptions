// Streams a colloquial-English rewrite of a committed caption sentence from an
// OpenAI-compatible chat-completions endpoint (default: OpenAI gpt-5.4-nano; base_url/model
// are config-overridable so Groq/DeepSeek etc. work with the same client). The literal
// translation stays on screen — this produces the third "spoken English" line under it.
use futures_util::StreamExt;
use serde_json::Value;

/// Constrained rewrite prompt: polish only, no additions — hallucinated content in live
/// captions is worse than a stiff translation.
const SYSTEM_PROMPT: &str = "You polish literal Chinese-to-English translations into natural, casual spoken English for live captions. Rewrite the draft only: keep the meaning of the Chinese source, add nothing, drop nothing. Prefer everyday conversational phrasing. Output only the rewritten sentence.";

/// Build the chat-completions request body.
/// `reasoning_effort: "none"` is load-bearing: gpt-5.x are reasoning models by default and
/// without it time-to-first-token balloons from <1s to 5s+, which kills the live feel.
/// (If you point llm_model at a non-reasoning model that rejects the field, the API error
/// will surface via the polish_error event — switch models or remove the field then.)
pub fn request_body(model: &str, zh: &str, draft: &str) -> Value {
    serde_json::json!({
        "model": model,
        "stream": true,
        "reasoning_effort": "none",
        // Generous cap: hidden reasoning tokens (if any) count toward it; the visible
        // rewrite itself is ~40 tokens.
        "max_completion_tokens": 2000,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": format!("Chinese: {zh}\nDraft: {draft}") }
        ]
    })
}

/// Drain complete SSE lines from `buf`, feeding each content delta to `on_delta`.
/// Byte-level buffering matters: network chunks split at arbitrary TCP/TLS boundaries, so a
/// multi-byte UTF-8 char (Chinese, curly quotes) can straddle two chunks — decoding per chunk
/// would corrupt it to U+FFFD. UTF-8 continuation bytes are never 0x0A, so splitting the raw
/// bytes on b'\n' is safe, and each complete line is complete UTF-8.
/// Returns Err if the stream carried an in-band error event (e.g. mid-stream abort).
fn drain_sse_lines(buf: &mut Vec<u8>, on_delta: &mut impl FnMut(&str)) -> Result<(), String> {
    while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
        let line_bytes: Vec<u8> = buf.drain(..=nl).collect();
        let line = String::from_utf8_lossy(&line_bytes);
        let line = line.trim();
        let Some(payload) = line.strip_prefix("data:") else { continue };
        let payload = payload.trim();
        if payload == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(payload) {
            if !v["error"].is_null() {
                return Err(format!("polish stream error event ({})", error_kind(&v)));
            }
            if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                if !delta.is_empty() {
                    on_delta(delta);
                }
            }
        }
    }
    Ok(())
}

/// A machine-readable error kind (error.code / error.type) from an API error payload.
/// NEVER include the raw body in errors: auth failures echo the submitted API key
/// (openai.com masks the middle; some OpenAI-compatible proxies don't), and our error
/// strings reach stderr and the frontend console.
fn error_kind(v: &Value) -> String {
    v["error"]["code"]
        .as_str()
        .or_else(|| v["error"]["type"].as_str())
        .unwrap_or("unknown")
        .to_string()
}

/// POST the request and stream the rewrite. Calls `on_delta` for each content chunk as it
/// arrives. Returns Ok(()) when the stream ends, Err on HTTP/network/stream failure.
pub async fn polish_stream(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    zh: &str,
    draft: &str,
    mut on_delta: impl FnMut(&str),
) -> Result<(), String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&request_body(model, zh, draft))
        .send()
        .await
        .map_err(|e| format!("polish request failed: {e}"))?;
    if !res.status().is_success() {
        let code = res.status();
        let body = res.text().await.unwrap_or_default();
        let kind = serde_json::from_str::<Value>(&body)
            .map(|v| error_kind(&v))
            .unwrap_or_else(|_| "unknown".to_string());
        // Status + machine-readable kind only — see error_kind() for why not the raw body.
        return Err(format!("polish http {code} ({kind})"));
    }

    let mut stream = res.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("polish stream error: {e}"))?;
        buf.extend_from_slice(&chunk);
        drain_sse_lines(&mut buf, &mut on_delta)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_has_expected_shape() {
        let b = request_body("gpt-5.4-nano", "你好", "Hello there");
        assert_eq!(b["model"], "gpt-5.4-nano");
        assert_eq!(b["stream"], true);
        assert_eq!(b["reasoning_effort"], "none"); // required: keeps TTFT sub-second
        assert_eq!(b["messages"][0]["role"], "system");
        let user = b["messages"][1]["content"].as_str().unwrap();
        assert!(user.contains("你好"));
        assert!(user.contains("Hello there"));
    }

    #[test]
    fn sse_survives_multibyte_char_split_across_chunks() {
        // U+2019 (’) = E2 80 99 — split it between two network chunks. Per-chunk decoding
        // would corrupt it to U+FFFD; byte buffering must keep it intact.
        let full = "data: {\"choices\":[{\"delta\":{\"content\":\"Let\u{2019}s go\"}}]}\n".as_bytes();
        let (a, b) = full.split_at(full.iter().position(|&x| x == 0xE2).unwrap() + 1);
        let mut buf: Vec<u8> = Vec::new();
        let mut out = String::new();
        buf.extend_from_slice(a);
        drain_sse_lines(&mut buf, &mut |d| out.push_str(d)).unwrap();
        assert_eq!(out, ""); // incomplete line stays buffered
        buf.extend_from_slice(b);
        drain_sse_lines(&mut buf, &mut |d| out.push_str(d)).unwrap();
        assert_eq!(out, "Let\u{2019}s go");
    }

    #[test]
    fn sse_accumulates_deltas_and_ignores_done() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(
            b"data: {\"choices\":[{\"delta\":{\"content\":\"Hey\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\ndata: [DONE]\n",
        );
        let mut out = String::new();
        drain_sse_lines(&mut buf, &mut |d| out.push_str(d)).unwrap();
        assert_eq!(out, "Hey there");
    }

    #[test]
    fn sse_in_band_error_event_is_reported_without_raw_body() {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(
            b"data: {\"error\":{\"code\":\"rate_limit_exceeded\",\"message\":\"secret sk-abc echo\"}}\n",
        );
        let err = drain_sse_lines(&mut buf, &mut |_| {}).unwrap_err();
        assert!(err.contains("rate_limit_exceeded"));
        assert!(!err.contains("sk-abc")); // never leak the body/key into error strings
    }
}
