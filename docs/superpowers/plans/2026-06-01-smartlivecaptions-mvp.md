# smartLiveCaptions MVP (P1 Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core working slice of smartLiveCaptions — in practice mode, capture the mic, transcribe Chinese speech in real time via OpenAI, show the Chinese original in a bottom always-on-top overlay, then on each finished sentence show an English translation below it.

**Architecture:** Tauri v2 desktop app. Frontend (vanilla TypeScript + Vite) captures mic audio, runs a simple energy-based VAD gate, holds caption state, and renders the bottom overlay. The Rust backend holds the OpenAI API key and owns all OpenAI network calls: it maintains the realtime transcription WebSocket (receiving streamed PCM16 frames from the frontend over a Tauri channel and emitting transcript events back) and performs HTTP translation. Pure-logic units (VAD, caption store, request building, event parsing, prompt building) are TDD'd; live audio/WS/overlay wiring is verified manually.

**Tech Stack:** Tauri v2, Rust (tokio, tokio-tungstenite, reqwest, serde_json), TypeScript, Vite, Vitest, Web Audio API.

**Scope:** This is Plan 1 of 3. MVP = practice mode (中→英) only. Out of this plan (later plans): interview mode + mode switch, TTS read-aloud, "other ways" variants, system tray, global hotkeys, click-through polish, settings UI.

---

## File Structure

**Frontend (`src/`)**
- `src/types.ts` — shared TS types (`AudioFrame`, `Utterance`, `Mode`, `LangPair`)
- `src/audio/vad.ts` — `EnergyVad` energy-threshold voice-activity gate (pure logic)
- `src/audio/capture.ts` — `AudioCapture` wraps getUserMedia → 16kHz PCM16 frames
- `src/state/captionStore.ts` — `CaptionStore` holds current utterance + rolling history, emits change events
- `src/services/transcription.ts` — frontend bridge: streams frames to Rust channel, subscribes to transcript events
- `src/services/translation.ts` — frontend bridge: calls Rust `translate` command
- `src/ui/overlay.ts` — `renderOverlay` draws the bottom caption bar from store state
- `src/config/langPrompts.ts` — `buildTranslationPrompt`, mode→language mapping (pure logic)
- `src/main.ts` — app entry; wires capture → vad → transcription → store → translation → overlay
- `src/styles.css` — overlay styling (bottom bar, translucent)

**Backend (`src-tauri/src/`)**
- `src-tauri/src/config.rs` — read OpenAI key from `config.local.json`
- `src-tauri/src/openai/mod.rs` — module exports
- `src-tauri/src/openai/translation.rs` — build Chat Completions request, parse response (pure) + async call
- `src-tauri/src/openai/transcription.rs` — realtime WS: parse server events (pure) + connection task
- `src-tauri/src/commands.rs` — Tauri commands (`translate`, `start_transcription`, `push_audio`, `stop_transcription`, `has_api_key`)
- `src-tauri/src/lib.rs` — Tauri app builder, state, command registration
- `src-tauri/tauri.conf.json` — window config (transparent, always-on-top, bottom bar)

**Tests**
- Frontend: colocated `*.test.ts` run by Vitest
- Backend: `#[cfg(test)]` modules run by `cargo test`

---

## Task 1: Scaffold the Tauri v2 + vanilla-ts project with test runners

**Files:**
- Create: whole project skeleton under `d:/AIProject/smartLiveCaptions/`
- Create: `package.json`, `vite.config.ts`, `src-tauri/Cargo.toml`, etc. (generated)

- [ ] **Step 1: Generate the Tauri app**

Run from the project root (the directory already exists and contains `docs/` and `.git/`):
```bash
cd /d/AIProject/smartLiveCaptions
npm create tauri-app@latest . -- --template vanilla-ts --manager npm --yes
```
If the tool refuses because the directory is non-empty, generate into a temp subfolder and move files:
```bash
npm create tauri-app@latest tmp-scaffold -- --template vanilla-ts --manager npm --yes
cp -r tmp-scaffold/. . && rm -rf tmp-scaffold
```
Expected: creates `package.json`, `index.html`, `src/main.ts`, `src-tauri/` (Cargo project), `vite.config.ts`.

- [ ] **Step 2: Install JS deps and add Vitest**

```bash
npm install
npm install -D vitest
```

- [ ] **Step 3: Add the test script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add a trivial passing test to confirm Vitest works**

Create `src/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run frontend tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Confirm Rust builds and tests run**

Run: `cd src-tauri && cargo test`
Expected: compiles; "0 tests" (or default test) passes. Return to root afterward: `cd ..`.

- [ ] **Step 7: Add Rust deps to `src-tauri/Cargo.toml`**

Under `[dependencies]` add:
```toml
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }
futures-util = "0.3"
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"
```
Run: `cd src-tauri && cargo build && cd ..`
Expected: builds successfully (downloads crates).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 vanilla-ts app with Vitest + Rust deps"
```

---

## Task 2: Shared types + translation prompt builder (frontend, TDD)

**Files:**
- Create: `src/types.ts`
- Create: `src/config/langPrompts.ts`
- Test: `src/config/langPrompts.test.ts`

- [ ] **Step 1: Define shared types**

Create `src/types.ts`:
```typescript
export type Mode = "practice"; // interview added in P2

export interface LangPair {
  source: "zh" | "en";
  target: "zh" | "en";
}

export interface Utterance {
  id: number;
  source: string;       // original transcript
  translation: string;  // translated text ("" until translated)
  sourceLang: "zh" | "en";
  done: boolean;        // true once the sentence is final
}

export type PcmFrame = Int16Array; // 16-bit PCM mono @ 16kHz
```

- [ ] **Step 2: Write the failing test for prompt + lang mapping**

Create `src/config/langPrompts.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { langPairForMode, buildTranslationPrompt } from "./langPrompts";

describe("langPairForMode", () => {
  it("practice mode maps zh->en", () => {
    expect(langPairForMode("practice")).toEqual({ source: "zh", target: "en" });
  });
});

describe("buildTranslationPrompt", () => {
  it("asks for one natural spoken translation and includes the text", () => {
    const p = buildTranslationPrompt("这个会议改到下周三", { source: "zh", target: "en" });
    expect(p).toContain("这个会议改到下周三");
    expect(p.toLowerCase()).toContain("english");
    expect(p.toLowerCase()).toContain("natural");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- langPrompts`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 4: Implement**

Create `src/config/langPrompts.ts`:
```typescript
import type { Mode, LangPair } from "../types";

export function langPairForMode(mode: Mode): LangPair {
  // practice = speak Chinese, see English
  return { source: "zh", target: "en" };
}

const LANG_NAME: Record<"zh" | "en", string> = { zh: "Chinese", en: "English" };

export function buildTranslationPrompt(text: string, pair: LangPair): string {
  const tgt = LANG_NAME[pair.target];
  return [
    `Translate the following ${LANG_NAME[pair.source]} sentence into one natural, idiomatic, spoken ${tgt} sentence.`,
    `Return ONLY the ${tgt} translation, no quotes, no explanation.`,
    ``,
    text,
  ].join("\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- langPrompts`
Expected: PASS (3 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config/langPrompts.ts src/config/langPrompts.test.ts
git commit -m "feat: shared types + translation prompt builder"
```

---

## Task 3: Energy VAD gate (frontend, TDD)

**Files:**
- Create: `src/audio/vad.ts`
- Test: `src/audio/vad.test.ts`

The VAD decides, per frame, whether speech is present, so we only stream audio when the user is talking (cost control). Simple RMS-energy threshold with a "hangover" so short pauses inside a sentence don't cut speech off.

- [ ] **Step 1: Write the failing test**

Create `src/audio/vad.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { EnergyVad } from "./vad";

function frame(amplitude: number, len = 320): Int16Array {
  const f = new Int16Array(len);
  for (let i = 0; i < len; i++) f[i] = amplitude;
  return f;
}

describe("EnergyVad", () => {
  it("reports silence for near-zero frames", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 3 });
    expect(vad.process(frame(0))).toBe(false);
  });

  it("reports speech when energy exceeds threshold", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 3 });
    expect(vad.process(frame(2000))).toBe(true);
  });

  it("keeps speech active during hangover after a loud frame", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 2 });
    vad.process(frame(2000));      // speech
    expect(vad.process(frame(0))).toBe(true);  // hangover 1
    expect(vad.process(frame(0))).toBe(true);  // hangover 2
    expect(vad.process(frame(0))).toBe(false); // hangover expired
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vad`
Expected: FAIL (EnergyVad undefined).

- [ ] **Step 3: Implement**

Create `src/audio/vad.ts`:
```typescript
export interface VadOptions {
  threshold: number;       // RMS amplitude threshold (PCM16 units)
  hangoverFrames: number;  // frames of speech to hold after energy drops
}

export class EnergyVad {
  private remaining = 0;
  constructor(private opts: VadOptions) {}

  /** Returns true if this frame should be treated as speech. */
  process(frame: Int16Array): boolean {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / Math.max(1, frame.length));
    if (rms >= this.opts.threshold) {
      this.remaining = this.opts.hangoverFrames;
      return true;
    }
    if (this.remaining > 0) {
      this.remaining--;
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- vad`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/audio/vad.ts src/audio/vad.test.ts
git commit -m "feat: energy-based VAD gate"
```

---

## Task 4: CaptionStore — current utterance + rolling history (frontend, TDD)

**Files:**
- Create: `src/state/captionStore.ts`
- Test: `src/state/captionStore.test.ts`

Holds the live utterance being spoken plus a capped rolling history of finished ones. Emits a change callback so the UI re-renders.

- [ ] **Step 1: Write the failing test**

Create `src/state/captionStore.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { CaptionStore } from "./captionStore";

describe("CaptionStore", () => {
  it("updates the live partial transcript", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("我在说", "zh");
    expect(s.current?.source).toBe("我在说");
    expect(s.current?.done).toBe(false);
  });

  it("commits the live utterance into history and clears current", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("第一句", "zh");
    const id = s.commit("第一句");
    expect(s.current).toBeNull();
    expect(s.history[0].id).toBe(id);
    expect(s.history[0].source).toBe("第一句");
    expect(s.history[0].done).toBe(true);
  });

  it("attaches a translation to a committed utterance by id", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("你好", "zh");
    const id = s.commit("你好");
    s.setTranslation(id, "Hello");
    expect(s.history[0].translation).toBe("Hello");
  });

  it("caps history to maxHistory, dropping oldest", () => {
    const s = new CaptionStore({ maxHistory: 2 });
    s.commit("a"); s.commit("b"); s.commit("c");
    expect(s.history.map((u) => u.source)).toEqual(["c", "b"]); // newest first
  });

  it("notifies subscribers on change", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    const cb = vi.fn();
    s.subscribe(cb);
    s.setPartial("x", "zh");
    expect(cb).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- captionStore`
Expected: FAIL (CaptionStore undefined).

- [ ] **Step 3: Implement**

Create `src/state/captionStore.ts`:
```typescript
import type { Utterance } from "../types";

export interface CaptionStoreOptions {
  maxHistory: number;
}

export class CaptionStore {
  current: Utterance | null = null;
  history: Utterance[] = []; // newest first
  private nextId = 1;
  private subscribers: Array<() => void> = [];

  constructor(private opts: CaptionStoreOptions) {}

  subscribe(cb: () => void): void {
    this.subscribers.push(cb);
  }

  private emit(): void {
    for (const cb of this.subscribers) cb();
  }

  setPartial(text: string, lang: "zh" | "en"): void {
    if (!this.current) {
      this.current = { id: this.nextId++, source: text, translation: "", sourceLang: lang, done: false };
    } else {
      this.current.source = text;
      this.current.sourceLang = lang;
    }
    this.emit();
  }

  /** Finalizes the current utterance (or creates one from `finalText`) and moves it to history. Returns its id. */
  commit(finalText: string, lang: "zh" | "en" = "zh"): number {
    const u: Utterance = this.current
      ? { ...this.current, source: finalText, done: true }
      : { id: this.nextId++, source: finalText, translation: "", sourceLang: lang, done: true };
    this.current = null;
    this.history.unshift(u);
    if (this.history.length > this.opts.maxHistory) this.history.length = this.opts.maxHistory;
    this.emit();
    return u.id;
  }

  setTranslation(id: number, translation: string): void {
    const u = this.history.find((x) => x.id === id) ?? (this.current?.id === id ? this.current : null);
    if (u) {
      u.translation = translation;
      this.emit();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- captionStore`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/captionStore.ts src/state/captionStore.test.ts
git commit -m "feat: caption store with rolling history"
```

---

## Task 5: Rust config loader for the OpenAI key (TDD)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod config;`)
- Create: `src-tauri/config.local.example.json`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/config.rs`:
```rust
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
fn default_transcription_model() -> String { "gpt-realtime-whisper".to_string() }

pub fn parse_config(json: &str) -> Result<AppConfig, String> {
    serde_json::from_str(json).map_err(|e| format!("bad config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_and_defaults() {
        let cfg = parse_config(r#"{"openai_api_key":"sk-test"}"#).unwrap();
        assert_eq!(cfg.openai_api_key, "sk-test");
        assert_eq!(cfg.translation_model, "gpt-4.1-nano");
        assert_eq!(cfg.transcription_model, "gpt-realtime-whisper");
    }

    #[test]
    fn errors_on_missing_key() {
        assert!(parse_config(r#"{}"#).is_err());
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add near the top:
```rust
mod config;
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd src-tauri && cargo test config:: && cd ..`
Expected: PASS (2 tests).

- [ ] **Step 4: Add a loader from disk + example file**

Append to `src-tauri/src/config.rs`:
```rust
use std::path::Path;

pub fn load_from_file(path: &Path) -> Result<AppConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path:?}: {e}"))?;
    parse_config(&text)
}
```

Create `src-tauri/config.local.example.json`:
```json
{
  "openai_api_key": "sk-REPLACE_ME",
  "translation_model": "gpt-4.1-nano",
  "transcription_model": "gpt-realtime-whisper"
}
```

- [ ] **Step 5: Run all Rust tests**

Run: `cd src-tauri && cargo test && cd ..`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/config.rs src-tauri/src/lib.rs src-tauri/config.local.example.json
git commit -m "feat: Rust OpenAI key/config loader"
```

---

## Task 6: Rust translation client (TDD request build + response parse)

**Files:**
- Create: `src-tauri/src/openai/mod.rs`
- Create: `src-tauri/src/openai/translation.rs`
- Modify: `src-tauri/src/lib.rs` (`mod openai;`)

Uses the Chat Completions HTTP API for a single best translation. We TDD the request body builder and the response parser; the actual network call is a thin async wrapper.

- [ ] **Step 1: Create the module file with builder + parser + tests**

Create `src-tauri/src/openai/translation.rs`:
```rust
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
```

- [ ] **Step 2: Create the module exports**

Create `src-tauri/src/openai/mod.rs`:
```rust
pub mod translation;
```

In `src-tauri/src/lib.rs`, add:
```rust
mod openai;
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test translation:: && cd ..`
Expected: PASS (3 tests).

- [ ] **Step 4: Add the async network call**

Append to `src-tauri/src/openai/translation.rs`:
```rust
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
```

- [ ] **Step 5: Verify it still builds + tests pass**

Run: `cd src-tauri && cargo test && cd ..`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/openai/ src-tauri/src/lib.rs
git commit -m "feat: Rust OpenAI translation client"
```

---

## Task 7: Rust realtime transcription — event parsing (TDD) + connection task

**Files:**
- Create: `src-tauri/src/openai/transcription.rs`
- Modify: `src-tauri/src/openai/mod.rs`

> **Verify against current docs during this task:** OpenAI's realtime transcription event names and the session-config shape may have changed since this plan was written. The parser below targets the known events `conversation.item.input_audio_transcription.delta` (partial) and `...completed` (final). Confirm at https://developers.openai.com/api/docs/guides/realtime-transcription and adjust the string constants if needed. The parser is isolated so only `parse_event` changes.

- [ ] **Step 1: Create the file with the event parser + tests**

Create `src-tauri/src/openai/transcription.rs`:
```rust
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
```

- [ ] **Step 2: Export it**

In `src-tauri/src/openai/mod.rs`, add:
```rust
pub mod transcription;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test transcription:: && cd ..`
Expected: PASS (4 tests).

- [ ] **Step 4: Add the connection task (manual-verified later)**

Append to `src-tauri/src/openai/transcription.rs`:
```rust
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
```

- [ ] **Step 5: Verify it builds + unit tests pass**

Run: `cd src-tauri && cargo test && cd ..`
Expected: PASS (build OK; parser tests green). Network is exercised in Task 11.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/openai/
git commit -m "feat: Rust realtime transcription parser + connection task"
```

---

## Task 8: Tauri commands + app state wiring (Rust)

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

Exposes commands the frontend calls: `has_api_key`, `translate`, `start_transcription`, `push_audio`, `stop_transcription`. Transcript events are pushed to the frontend via Tauri's event system on channel `"transcript"`.

- [ ] **Step 1: Create the commands module**

Create `src-tauri/src/commands.rs`:
```rust
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
    translation::translate(&state.http, &state.config.openai_api_key, &state.config.translation_model, &prompt).await
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
                transcription::TranscriptEvent::Partial(t) => Some(TranscriptPayload { kind: "partial".into(), text: t }),
                transcription::TranscriptEvent::Final(t) => Some(TranscriptPayload { kind: "final".into(), text: t }),
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
        tx.send(pcm).map_err(|e| format!("audio send failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn stop_transcription(state: State<AppState>) {
    *state.audio_tx.lock().unwrap() = None; // dropping the sender ends the connection loop
}
```

- [ ] **Step 2: Wire state + commands in `lib.rs`**

Edit `src-tauri/src/lib.rs` so the run function builds state and registers commands. Replace the generated `run()` body with:
```rust
mod config;
mod openai;
mod commands;

use commands::AppState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cfg_path = std::path::Path::new("config.local.json");
    let config = config::load_from_file(cfg_path).unwrap_or_else(|e| {
        eprintln!("WARNING: {e}. Copy config.local.example.json to config.local.json and set your key.");
        config::AppConfig {
            openai_api_key: String::new(),
            translation_model: "gpt-4.1-nano".into(),
            transcription_model: "gpt-realtime-whisper".into(),
        }
    });

    let state = AppState {
        config,
        http: reqwest::Client::new(),
        audio_tx: Mutex::new(None),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::translate,
            commands::start_transcription,
            commands::push_audio,
            commands::stop_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
> Note: make `AppConfig` fields `pub` (already are) and ensure `config::AppConfig` is constructible here.

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build && cd ..`
Expected: compiles. Fix any import/visibility errors surfaced by the compiler.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: Tauri commands for translate + transcription streaming"
```

---

## Task 9: Frontend service bridges (transcription + translation)

**Files:**
- Create: `src/services/translation.ts`
- Create: `src/services/transcription.ts`

Thin wrappers over Tauri `invoke` / event listeners. (These are integration glue; verified end-to-end in Task 11.)

- [ ] **Step 1: Translation bridge**

Create `src/services/translation.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { buildTranslationPrompt } from "../config/langPrompts";
import type { LangPair } from "../types";

export async function translate(text: string, pair: LangPair): Promise<string> {
  const prompt = buildTranslationPrompt(text, pair);
  return await invoke<string>("translate", { prompt });
}
```

- [ ] **Step 2: Transcription bridge**

Create `src/services/transcription.ts`:
```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TranscriptMsg {
  kind: "partial" | "final";
  text: string;
}

export async function startTranscription(language: "zh" | "en"): Promise<void> {
  await invoke("start_transcription", { language });
}

export async function stopTranscription(): Promise<void> {
  await invoke("stop_transcription");
}

export async function pushAudio(pcm: Int16Array): Promise<void> {
  // Tauri serializes number[] to Vec<u8>; send raw little-endian bytes.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  await invoke("push_audio", { pcm: Array.from(bytes) });
}

export function onTranscript(cb: (m: TranscriptMsg) => void): Promise<UnlistenFn> {
  return listen<TranscriptMsg>("transcript", (e) => cb(e.payload));
}
```

- [ ] **Step 3: Install the Tauri API package if missing**

Run: `npm install @tauri-apps/api`
Expected: installs (Tauri v2 frontend API).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors in these files.

- [ ] **Step 5: Commit**

```bash
git add src/services/ package.json package-lock.json
git commit -m "feat: frontend bridges for transcription + translation"
```

---

## Task 10: AudioCapture + overlay UI + window config

**Files:**
- Create: `src/audio/capture.ts`
- Create: `src/ui/overlay.ts`
- Modify: `src/styles.css`
- Modify: `index.html`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: AudioCapture (getUserMedia → 16kHz PCM16 frames)**

Create `src/audio/capture.ts`:
```typescript
export type FrameHandler = (frame: Int16Array) => void;

export class AudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;

  async start(onFrame: FrameHandler): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0); // Float32 [-1,1]
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      onFrame(pcm);
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
  }
}
```

- [ ] **Step 2: Overlay renderer**

Create `src/ui/overlay.ts`:
```typescript
import type { CaptionStore } from "../state/captionStore";
import type { Utterance } from "../types";

function blockHtml(u: Utterance, live: boolean): string {
  const origClass = u.sourceLang === "zh" ? "orig zh" : "orig en";
  const cursor = live ? '<span class="cursor"></span>' : "";
  const trans = u.translation ? `<div class="trans">${escapeHtml(u.translation)}</div>` : "";
  return `<div class="blk${live ? " live" : ""}">
    <div class="${origClass}">${escapeHtml(u.source)}${cursor}</div>
    ${trans}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

export function renderOverlay(root: HTMLElement, store: CaptionStore): void {
  const blocks: string[] = [];
  // oldest at top, newest/current at bottom
  for (const u of [...store.history].reverse()) blocks.push(blockHtml(u, false));
  if (store.current) blocks.push(blockHtml(store.current, true));
  root.innerHTML = `<div class="bar">${blocks.join("")}</div>`;
}
```

- [ ] **Step 3: Styles**

Replace `src/styles.css` with:
```css
html, body { margin: 0; height: 100%; background: transparent; overflow: hidden;
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
#app { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; }
.bar { max-width: 92vw; margin: 0 0 18px; padding: 10px 14px;
  background: rgba(15,16,20,.88); border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.blk { margin-bottom: 8px; } .blk:last-child { margin-bottom: 0; }
.blk:not(.live) { opacity: .5; }
.orig { font-size: 18px; font-weight: 600; line-height: 1.4; }
.orig.zh { color: #9fd0ff; } .orig.en { color: #a9e8c0; }
.trans { margin-top: 5px; padding: 6px 9px; font-size: 16px; color: #eef1f6;
  background: rgba(255,255,255,.07); border-left: 3px solid #5b8def; border-radius: 6px; }
.cursor { display: inline-block; width: 2px; height: 16px; background: #9fd0ff;
  margin-left: 3px; vertical-align: -2px; animation: blink .8s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
```

- [ ] **Step 4: Minimal `index.html` body**

Ensure `index.html` has `<div id="app"></div>` and loads `src/main.ts`, and a link to `styles.css`. Replace `<body>...</body>` with:
```html
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 5: Configure the overlay window**

In `src-tauri/tauri.conf.json`, set the window object under `app.windows[0]` to:
```json
{
  "title": "smartLiveCaptions",
  "width": 900,
  "height": 320,
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "shadow": false
}
```
And ensure `app.security.csp` allows connecting to OpenAI is not needed (calls are in Rust), but the WebView needs mic permission — no extra config for getUserMedia on Windows WebView2 beyond the OS prompt.

- [ ] **Step 6: Verify build compiles**

Run: `npx tsc --noEmit && cd src-tauri && cargo build && cd ..`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/audio/capture.ts src/ui/overlay.ts src/styles.css index.html src-tauri/tauri.conf.json
git commit -m "feat: audio capture, overlay renderer, transparent window config"
```

---

## Task 11: Wire everything in main.ts + end-to-end manual verification

**Files:**
- Modify: `src/main.ts`
- Create: `src-tauri/config.local.json` (user's real key — gitignored)

- [ ] **Step 1: Wire the pipeline**

Replace `src/main.ts` with:
```typescript
import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { renderOverlay } from "./ui/overlay";
import { startTranscription, pushAudio, onTranscript } from "./services/transcription";
import { translate } from "./services/translation";
import { langPairForMode } from "./config/langPrompts";

const root = document.getElementById("app")!;
const store = new CaptionStore({ maxHistory: 5 });
store.subscribe(() => renderOverlay(root, store));

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();
const pair = langPairForMode("practice"); // zh -> en

async function main() {
  await startTranscription(pair.source);

  await onTranscript(async (m) => {
    if (m.kind === "partial") {
      store.setPartial(m.text, pair.source);
    } else if (m.kind === "final" && m.text.trim()) {
      const id = store.commit(m.text, pair.source);
      try {
        const en = await translate(m.text, pair);
        store.setTranslation(id, en);
      } catch (e) {
        store.setTranslation(id, `⚠️ 翻译失败: ${e}`);
      }
    }
  });

  await capture.start((frame) => {
    if (vad.process(frame)) {
      void pushAudio(frame);
    }
  });
}

main().catch((e) => {
  root.innerHTML = `<div class="bar"><div class="orig en">启动失败: ${e}</div></div>`;
});
```

- [ ] **Step 2: Create the local config with a real key**

Copy the example and insert the user's OpenAI key:
```bash
cp src-tauri/config.local.example.json src-tauri/config.local.json
```
Edit `src-tauri/config.local.json` and set `openai_api_key` to a real key. (This file is gitignored via `*.local.json`.)

- [ ] **Step 3: Run the app**

Run: `npm run tauri dev`
Expected: a frameless translucent window docked near the bottom; Windows prompts for microphone permission — allow it.

- [ ] **Step 4: Manual verification — practice mode**

Speak a Chinese sentence, e.g. "这个会议我们改到下周三吧". Verify:
  1. Chinese text appears (blue) and updates as you speak (partial).
  2. On finishing the sentence, it commits and an English translation appears below it within ~1-2s.
  3. Speaking a second sentence rolls the first one up and dims it.
  4. Silence does not stream audio (check the OpenAI usage dashboard or add a temporary `console.log` in the VAD branch to confirm gating).

If transcription never appears: open devtools (right-click → Inspect), check for errors; verify the realtime event names against current OpenAI docs (Task 7 note) and that the key is valid.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire end-to-end practice-mode pipeline (MVP working)"
```

---

## Self-Review (completed by plan author)

**Spec coverage (MVP scope):**
- Mic capture → Task 10 (AudioCapture). ✓
- VAD cost gating → Task 3 + Task 11 wiring. ✓
- Realtime transcription, language hint → Task 7 (`session_update` language) + Task 8. ✓
- Original-on-top display → Task 10 overlay (orig line) + Task 11. ✓
- Sentence-final → translation below → Task 6 + Task 11. ✓
- Translation via swappable model (default gpt-4.1-nano) → Task 5/6 (model from config). ✓
- Rolling history, newest at bottom, dim older → Task 4 + Task 10. ✓
- Bottom always-on-top translucent overlay → Task 10 tauri.conf + styles. ✓
- Key kept in Rust → Task 5/8 (config in Rust, all OpenAI calls in Rust). ✓
- No history persistence → CaptionStore is in-memory only. ✓

**Deferred to P2/P3 (intentionally not in this plan):** interview mode + mode switch, TTS read-aloud (▶️), variants (💡), system tray, global hotkeys, click-through, settings UI, reconnect-on-drop hardening.

**Placeholder scan:** No TBD/TODO. The one external-API caveat (Task 7) is a concrete parser with a documented verification step, not a placeholder.

**Type consistency:** `Utterance` fields (`id, source, translation, sourceLang, done`) are used consistently in Tasks 2/4/10. `TranscriptEvent`/`TranscriptPayload` (`kind`/`text`) consistent across Tasks 7/8/9/11. `langPairForMode`/`buildTranslationPrompt` signatures match across Tasks 2/6/9/11. Command names (`translate`, `start_transcription`, `push_audio`, `stop_transcription`, `has_api_key`) consistent across Rust Task 8 and TS Task 9.

**Known risk to watch during execution:** `ScriptProcessorNode` is deprecated; if audio is choppy, migrate to an `AudioWorklet` (noted for P3 polish). The OpenAI realtime event schema is the highest-risk external dependency — verify early in Task 11.
