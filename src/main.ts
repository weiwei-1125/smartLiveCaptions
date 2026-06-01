import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { renderOverlay } from "./ui/overlay";
import {
  startTranscription,
  stopTranscription,
  pushAudio,
  onTranscript,
  onConnError,
} from "./services/transcription";
import { translate } from "./services/translation";
import { planUtterance, detectLang, transcriptionLangHint } from "./config/modes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Mode } from "./types";

const root = document.getElementById("app")!;
const store = new CaptionStore({ maxHistory: 5 });

let mode: Mode = "practice";
let conn = "启动中…";
let framesSent = 0; // diagnostic: mic frames forwarded (climbs while you speak)

function statusText(): string {
  return `${conn} · 🎤 ${framesSent}`;
}
function render() {
  renderOverlay(root, store, { statusText: statusText(), mode });
}
store.subscribe(render);

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();

// Decide per finished sentence whether to translate (and which direction) or just
// show the original, based on the current mode + detected language.
async function handleFinal(text: string) {
  const plan = planUtterance(mode, text);
  const id = store.commit(text, plan.sourceLang);
  if (plan.translateTo === null) return; // passthrough: show the original only
  try {
    const out = await translate(text, { source: plan.sourceLang, target: plan.translateTo });
    store.setTranslation(id, out);
  } catch (e) {
    store.setTranslation(id, `⚠️ 翻译失败: ${e}`);
  }
}

// Switch practice <-> interview: restart the transcription session with the new
// language hint. The mic keeps running; only the transcription stream is reset.
async function toggleMode() {
  mode = mode === "practice" ? "interview" : "practice";
  conn = "切换中…";
  render();
  try {
    await stopTranscription();
    await startTranscription(transcriptionLangHint(mode));
    conn = "已连接，正在听…";
  } catch (e) {
    conn = `切换失败: ${e}`;
  }
  render();
}

// Delegated handlers bound once on the stable root (the overlay rebuilds innerHTML
// each render). Click on the mode button toggles mode; mousedown on the ⠿ handle
// starts a native window drag (more reliable than data-tauri-drag-region).
root.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-action='toggle-mode']")) void toggleMode();
});
root.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-drag]")) {
    // setFocus before startDragging works around tauri-apps/tauri#11605.
    // Requires the core:window:allow-start-dragging capability (see capabilities/default.json).
    const win = getCurrentWindow();
    win.setFocus().finally(() => void win.startDragging().catch(() => {}));
  }
});

async function main() {
  render(); // render the bar immediately so the (transparent) window is visible

  await onConnError((msg) => {
    conn = `⚠️ 连接失败: ${msg}`;
    render();
  });

  await onTranscript(async (m) => {
    if (m.kind === "partial") {
      store.setPartial(m.text, detectLang(m.text));
    } else if (m.kind === "final" && m.text.trim()) {
      await handleFinal(m.text);
    }
  });

  await startTranscription(transcriptionLangHint(mode));
  conn = "已连接，正在听…";
  render();

  await capture.start((frame) => {
    if (vad.process(frame)) {
      framesSent++;
      void pushAudio(frame);
      if (framesSent % 4 === 0) render(); // refresh the mic-frame counter periodically
    }
  });
}

main().catch((e) => {
  conn = `启动失败: ${e}`;
  render();
});
