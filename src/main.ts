import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { SentenceAssembler } from "./state/sentenceAssembler";
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
// In-memory only (cleared on exit). Large enough to scroll back through a session.
const store = new CaptionStore({ maxHistory: 200 });

let mode: Mode = "practice";
let micOn = true;
let conn = "启动中…";
let framesSent = 0; // diagnostic: mic frames forwarded (climbs while you speak)

function statusText(): string {
  return `${conn} · 🎤 ${framesSent}`;
}
function render() {
  renderOverlay(root, store, { statusText: statusText(), mode, micOn });
}
store.subscribe(render);

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();

// Gate mic frames through the VAD and forward speech to the transcription stream.
function onFrame(frame: Int16Array) {
  if (vad.process(frame)) {
    framesSent++;
    void pushAudio(frame);
    // The diagnostic counter is non-essential; refresh it rarely to avoid re-render
    // churn that would fight scroll-back. Caption updates re-render on store changes.
    if (framesSent % 30 === 0) render();
  }
}

// Mic on/off: releases the microphone when off (privacy + no audio uploaded).
async function toggleMic() {
  micOn = !micOn;
  try {
    if (micOn) await capture.start(onFrame);
    else capture.stop();
  } catch (e) {
    conn = `麦克风错误: ${e}`;
  }
  render();
}

// Commit ONE finished sentence to history and translate it (per the current mode +
// detected language). Called by the sentence assembler, not on every acoustic segment.
async function handleFinal(text: string) {
  const plan = planUtterance(mode, text);
  const id = store.addFinal(text, plan.sourceLang);
  if (plan.translateTo === null) return; // passthrough: show the original only
  try {
    const out = await translate(text, { source: plan.sourceLang, target: plan.translateTo });
    store.setTranslation(id, out);
  } catch (e) {
    store.setTranslation(id, `⚠️ 翻译失败: ${e}`);
  }
}

// Assemble acoustic segments into sentences before committing/translating. liveSegment
// is the current acoustic segment's accumulating text; the live caption line shows the
// in-progress SENTENCE = assembler buffer (held across pauses) + liveSegment.
let liveSegment = "";
const assembler = new SentenceAssembler({
  idleMs: 700,
  maxChars: 160,
  onSentence: (s) => {
    void handleFinal(s);
    refreshLive();
  },
});
function refreshLive() {
  const buf = assembler.peek();
  const live =
    buf && liveSegment && /[A-Za-z0-9]$/.test(buf) && /^[A-Za-z0-9]/.test(liveSegment)
      ? buf + " " + liveSegment
      : buf + liveSegment;
  store.setPartial(live, detectLang(live));
}

// Switch practice <-> interview: restart the transcription session with the new
// language hint. The mic keeps running; only the transcription stream is reset.
// `switching` guards against a fast double-toggle racing two stop/start cycles.
let switching = false;
async function toggleMode() {
  if (switching) return;
  switching = true;
  mode = mode === "practice" ? "interview" : "practice";
  assembler.reset(); // drop any half-assembled sentence from the old session
  liveSegment = "";
  store.current = null; // drop any in-flight partial from the old session
  conn = "切换中…";
  render();
  try {
    await stopTranscription();
    await startTranscription(transcriptionLangHint(mode));
    conn = "已连接，正在听…";
  } catch (e) {
    conn = `切换失败: ${e}`;
  } finally {
    switching = false;
  }
  render();
}

// One delegated mousedown handler on the stable root. We use mousedown (not click)
// for BOTH actions because the overlay rebuilds innerHTML every ~340ms while you
// speak — a click (mousedown+mouseup on the SAME node) would be lost when the node
// is replaced mid-gesture.
root.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-action='clear']")) {
    store.clear();
    render();
    return;
  }
  if (target.closest("[data-action='close']")) {
    void getCurrentWindow().close();
    return;
  }
  if (target.closest("[data-action='toggle-mic']")) {
    void toggleMic();
    return;
  }
  if (target.closest("[data-action='toggle-mode']")) {
    void toggleMode();
    return;
  }
  if (target.closest("[data-drag]")) {
    // setFocus before startDragging works around tauri-apps/tauri#11605.
    // Requires the core:window:allow-start-dragging capability (capabilities/default.json).
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

  await onTranscript((m) => {
    if (m.kind === "partial") {
      liveSegment += m.text; // accumulate the current acoustic segment
      assembler.touch(); // speech in progress — keep the idle flush from firing
      refreshLive();
    } else if (m.kind === "final" && m.text.trim()) {
      liveSegment = ""; // segment done; its text is authoritative via the assembler
      assembler.feed(m.text); // splits into sentences / merges fragments → handleFinal
      refreshLive(); // show the in-progress remainder (or clear)
    }
  });

  await startTranscription(transcriptionLangHint(mode));
  conn = "已连接，正在听…";
  render();

  await capture.start(onFrame);
}

main().catch((e) => {
  conn = `启动失败: ${e}`;
  render();
});
