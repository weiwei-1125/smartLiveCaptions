use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub openai_api_key: String,
    #[serde(default = "default_translation_model")]
    pub translation_model: String,
    #[serde(default = "default_transcription_model")]
    pub transcription_model: String,
}

fn default_translation_model() -> String { "gpt-4.1-nano".to_string() }
fn default_transcription_model() -> String { "gpt-4o-transcribe".to_string() }

pub fn parse_config(json: &str) -> Result<AppConfig, String> {
    serde_json::from_str(json).map_err(|e| format!("bad config: {e}"))
}

use std::path::Path;

pub fn load_from_file(path: &Path) -> Result<AppConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path:?}: {e}"))?;
    parse_config(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_and_defaults() {
        let cfg = parse_config(r#"{"openai_api_key":"sk-test"}"#).unwrap();
        assert_eq!(cfg.openai_api_key, "sk-test");
        assert_eq!(cfg.translation_model, "gpt-4.1-nano");
        assert_eq!(cfg.transcription_model, "gpt-4o-transcribe");
    }

    #[test]
    fn errors_on_missing_key() {
        assert!(parse_config(r#"{}"#).is_err());
    }
}
