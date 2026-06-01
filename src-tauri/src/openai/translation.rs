use serde_json::{json, Value};

/// Build the Chat Completions request body for a one-shot translation.
pub fn build_request(model: &str, prompt: &str) -> Value {
    json!({
        "model": model,
        "messages": [
            { "role": "system", "content": "You are a precise, natural translator. Output only the translation." },
            { "role": "user", "content": prompt }
        ],
        "temperature": 0.3,
        "max_tokens": 200
    })
}

/// Extract the translated text from a Chat Completions response body.
pub fn parse_response(body: &Value) -> Result<String, String> {
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "no content in response".to_string())
}

pub async fn translate(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&build_request(model, prompt))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| format!("bad json: {e}"))?;
    if !status.is_success() {
        return Err(format!("openai error {status}: {body}"));
    }
    parse_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_includes_model_and_prompt() {
        let req = build_request("gpt-4.1-nano", "Translate: 你好");
        assert_eq!(req["model"], "gpt-4.1-nano");
        assert_eq!(req["messages"][1]["content"], "Translate: 你好");
    }

    #[test]
    fn parses_content() {
        let body = json!({ "choices": [ { "message": { "content": "  Hello  " } } ] });
        assert_eq!(parse_response(&body).unwrap(), "Hello");
    }

    #[test]
    fn errors_when_missing() {
        let body = json!({ "choices": [] });
        assert!(parse_response(&body).is_err());
    }
}
