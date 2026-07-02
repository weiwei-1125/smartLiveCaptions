use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AppConfig {
    /// The user's own Soniox API key (entered in Settings, stored per-user). Never bundled.
    pub soniox_api_key: String,
    /// Accelerator string for the opt-in global mute hotkey (e.g. "Pause", "Ctrl+Alt+M").
    /// Empty = no global hotkey registered (the default — nothing is grabbed system-wide).
    #[serde(default)]
    pub mute_hotkey: String,
    /// The user's own OpenAI API key for the optional colloquial-English polish line.
    /// Empty = polish feature off (the default). Never bundled, same as the Soniox key.
    #[serde(default)]
    pub openai_api_key: String,
    /// OpenAI-compatible endpoint + model for the polish step. Only the key is exposed in
    /// the settings UI; power users can hand-edit these in config.json to point at any
    /// OpenAI-compatible provider (Groq, DeepSeek, ...).
    #[serde(default = "default_llm_base_url")]
    pub llm_base_url: String,
    #[serde(default = "default_llm_model")]
    pub llm_model: String,
}

pub fn default_llm_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

pub fn default_llm_model() -> String {
    "gpt-5.4-nano".to_string()
}

impl AppConfig {
    /// A fresh, key-less config: the app starts in this state on a clean install and
    /// prompts the user for their own key. Never ship a build with a key baked in.
    pub fn keyless() -> Self {
        AppConfig {
            soniox_api_key: String::new(),
            mute_hotkey: String::new(),
            openai_api_key: String::new(),
            llm_base_url: default_llm_base_url(),
            llm_model: default_llm_model(),
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
    fn parses_key() {
        let cfg = parse_config(r#"{"soniox_api_key":"sk-test"}"#).unwrap();
        assert_eq!(cfg.soniox_api_key, "sk-test");
        assert_eq!(cfg.mute_hotkey, ""); // defaulted
        assert_eq!(cfg.openai_api_key, ""); // defaulted → polish off
        assert_eq!(cfg.llm_base_url, "https://api.openai.com/v1"); // defaulted
        assert_eq!(cfg.llm_model, "gpt-5.4-nano"); // defaulted
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
            soniox_api_key: "sk-roundtrip".into(),
            mute_hotkey: "Pause".into(),
            openai_api_key: "sk-llm".into(),
            ..AppConfig::keyless()
        };
        save_to_file(&path, &cfg).unwrap();
        let loaded = load_from_file(&path).unwrap();
        assert_eq!(loaded.soniox_api_key, "sk-roundtrip");
        assert_eq!(loaded.mute_hotkey, "Pause");
        assert_eq!(loaded.openai_api_key, "sk-llm");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_or_default_returns_keyless_when_missing() {
        let path = std::env::temp_dir().join("slc_definitely_missing_84213.json");
        let _ = std::fs::remove_file(&path);
        let cfg = load_or_default(&path);
        assert_eq!(cfg.soniox_api_key, ""); // keyless → app will prompt for a key
    }

    #[test]
    fn load_or_default_reads_existing_file() {
        let path = std::env::temp_dir().join("slc_load_or_default_existing.json");
        let cfg = AppConfig {
            soniox_api_key: "sk-existing".into(),
            ..AppConfig::keyless()
        };
        save_to_file(&path, &cfg).unwrap();
        let loaded = load_or_default(&path);
        assert_eq!(loaded.soniox_api_key, "sk-existing");
        let _ = std::fs::remove_file(&path);
    }
}
