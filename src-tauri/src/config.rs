use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppConfig {
    pub openai_api_key: String,
    #[serde(default = "default_translation_model")]
    pub translation_model: String,
    #[serde(default = "default_transcription_model")]
    pub transcription_model: String,
}

fn default_translation_model() -> String { "gpt-4.1-nano".to_string() }
fn default_transcription_model() -> String { "gpt-4o-transcribe".to_string() }

impl AppConfig {
    /// A fresh, key-less config: the app starts in this state on a clean install and
    /// prompts the user for their own key. Never ship a build with a key baked in.
    pub fn keyless() -> Self {
        AppConfig {
            openai_api_key: String::new(),
            translation_model: default_translation_model(),
            transcription_model: default_transcription_model(),
        }
    }
}

pub fn parse_config(json: &str) -> Result<AppConfig, String> {
    serde_json::from_str(json).map_err(|e| format!("bad config: {e}"))
}

use std::path::Path;

pub fn load_from_file(path: &Path) -> Result<AppConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path:?}: {e}"))?;
    parse_config(&text)
}

/// Persist the config as pretty JSON, creating the parent directory if needed.
/// This is where the user's own key is stored (per-user app config dir).
pub fn save_to_file(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {dir:?}: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("cannot write {path:?}: {e}"))
}

/// Load the config from `path`, falling back to a key-less default when the file is
/// absent or unreadable (e.g. a fresh install that has never saved a key).
pub fn load_or_default(path: &Path) -> AppConfig {
    load_from_file(path).unwrap_or_else(|_| AppConfig::keyless())
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

    #[test]
    fn save_then_load_round_trips() {
        let path = std::env::temp_dir().join("slc_save_then_load.json");
        let _ = std::fs::remove_file(&path);
        let cfg = AppConfig {
            openai_api_key: "sk-roundtrip".into(),
            translation_model: "gpt-4.1-nano".into(),
            transcription_model: "gpt-4o-transcribe".into(),
        };
        save_to_file(&path, &cfg).unwrap();
        let loaded = load_from_file(&path).unwrap();
        assert_eq!(loaded.openai_api_key, "sk-roundtrip");
        assert_eq!(loaded.translation_model, "gpt-4.1-nano");
        assert_eq!(loaded.transcription_model, "gpt-4o-transcribe");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_or_default_returns_keyless_when_missing() {
        let path = std::env::temp_dir().join("slc_definitely_missing_84213.json");
        let _ = std::fs::remove_file(&path);
        let cfg = load_or_default(&path);
        assert_eq!(cfg.openai_api_key, ""); // keyless → app will prompt for a key
        assert_eq!(cfg.translation_model, "gpt-4.1-nano");
        assert_eq!(cfg.transcription_model, "gpt-4o-transcribe");
    }

    #[test]
    fn load_or_default_reads_existing_file() {
        let path = std::env::temp_dir().join("slc_load_or_default_existing.json");
        let cfg = AppConfig {
            openai_api_key: "sk-existing".into(),
            translation_model: "gpt-4.1-nano".into(),
            transcription_model: "gpt-4o-transcribe".into(),
        };
        save_to_file(&path, &cfg).unwrap();
        let loaded = load_or_default(&path);
        assert_eq!(loaded.openai_api_key, "sk-existing");
        let _ = std::fs::remove_file(&path);
    }
}
