# smartLiveCaptions

A lightweight desktop **overlay** that turns your microphone into **real-time bilingual
captions** (Simplified Chinese ⇄ English). It streams audio to [Soniox](https://soniox.com)
for live speech-to-text with automatic language identification and native two-way
translation, then shows the text in a frameless, always-on-top window you can park over
any app (calls, meetings, videos, study).

Built with **Tauri v2** (Rust backend) + **vanilla TypeScript** (Vite). Cross-platform:
runs on **Windows** and **macOS**.

## Features

- **Live, self-correcting captions** — text appears as you speak and revises into clean
  sentences (Soniox streaming + semantic endpointing), not one dump at the end.
- **Two-way translation** — automatic zh⇄en; no manual direction toggle.
- **断句节奏 (pacing) control** — 快 / 平衡 / 整句 tunes how eagerly sentences are closed.
- **Floating overlay** — transparent, borderless, always-on-top; drag anywhere, pin/minimize/
  maximize, adjustable caption font size.
- **Floating mic button** with live voice-activity glow; optional global mute hotkey.
- **Copy** any line (original / translation) or the whole conversation.
- **Bring-your-own key, keyless build** — no API key is ever bundled. A fresh install starts
  empty and prompts for *your own* Soniox key (stored per-user, never uploaded).

## Tech stack

| Layer | Tech |
|---|---|
| Shell / native | Tauri v2 (Rust), tokio-tungstenite (Soniox WebSocket), global-shortcut |
| Frontend | Vanilla TypeScript, Vite |
| Tests | Vitest (frontend) · `cargo test` (Rust) |
| STT / translation | Soniox real-time API (`stt-rt-v4`) |

## Prerequisites

- **Node.js 18+** and npm
- **Rust** (stable) — install via [rustup](https://rustup.rs)
- Platform toolchain:
  - **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and WebView2 (preinstalled on Win 10/11)
  - **macOS:** Xcode Command Line Tools — `xcode-select --install`
- A **Soniox API key** — create one at [console.soniox.com](https://console.soniox.com)

## Quick start (development)

```bash
npm install

# Dev convenience: drop your Soniox key in a gitignored local config so the app
# auto-loads it while developing. (In a shipped build you'd enter it in Settings instead.)
cp src-tauri/config.local.example.json src-tauri/config.local.json
#   then edit src-tauri/config.local.json and set "soniox_api_key"

npm run tauri dev
```

`config.local.json` and `.env*` are gitignored — your key never gets committed.

## Build a desktop installer

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`:

- **Windows:** `nsis/smartLiveCaptions_<ver>_x64-setup.exe` and `msi/…_x64_en-US.msi`
- **macOS:** `dmg/…​.dmg` and `macos/smartLiveCaptions.app`

> **macOS bundles must be built on macOS.** Tauri can't cross-compile a Windows machine
> into a macOS app (Apple toolchain + signing). To get a Mac build, clone the repo on a
> Mac and run `npm run tauri build` there.

### Using a packaged build

The installer ships **keyless**. On first launch, open **Settings (⚙)** and paste your own
Soniox key — it's saved to your per-user app-config directory, never bundled or uploaded.

## macOS notes

- **Transparency** is enabled via `app.macOSPrivateApi` in `tauri.conf.json` (already set).
- **Microphone permission** — the app declares `NSMicrophoneUsageDescription`
  (`src-tauri/Info.plist`); macOS prompts on first use.
- **Global mute hotkey** (optional) needs *System Settings → Privacy & Security →
  Accessibility* permission, granted at runtime.
- **Unsigned app + Gatekeeper** — a locally built, unsigned `.app`/`.dmg` will be blocked
  ("unidentified developer"). Right-click → **Open** the first time, or proper distribution
  needs an Apple Developer ID signature + notarization.

## Tests

```bash
npm test                                   # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust
```

## Project layout

```
src/                 frontend (TS): audio capture, caption store, overlay UI, services
src-tauri/src/       Rust: Soniox WS client (soniox.rs), commands, config, app setup
src-tauri/tauri.conf.json   window + bundle config
```

## Security

No API key is ever committed or bundled. The dev key lives only in the gitignored
`src-tauri/config.local.json`; the bundle declares no resources that could package it; a
fresh install falls back to a keyless config and prompts for the user's own key.
