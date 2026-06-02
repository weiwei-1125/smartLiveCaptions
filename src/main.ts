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

// Sensitivity presets. silenceMs = server VAD acoustic-commit boundary (smaller =
// text appears sooner); idleMs = how long the assembler holds a punctuation-less
// fragment before committing it (larger = a thinking pause won't split a sentence).
type Level = "fast" | "balanced" | "full";
const LEVELS: Record<Level, { icon: string; name: string; silenceMs: number; idleMs: number }> = {
  fast: { icon: "⚡", name: "快", silenceMs: 250, idleMs: 1200 },
  balanced: { icon: "⚖️", name: "平衡", silenceMs: 350, idleMs: 1600 },
  full: { icon: "📝", name: "整句", silenceMs: 500, idleMs: 2400 },
};
const LEVEL_ORDER: Level[] = ["fast", "balanced", "full"];

let mode: Mode = "practice";
let micOn = true;
let level: Level = "balanced";
let conn = "启动中…";
let framesSent = 0; // diagnostic: mic frames forwarded (climbs while you speak)

function statusText(): string {
  return `${conn} · 🎤 ${framesSent}`;
}
function render() {
  renderOverlay(root, store, {
    statusText: statusText(),
    mode,
    micOn,
    level: LEVELS[level].icon,
    levelName: LEVELS[level].name,
  });
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
  idleMs: LEVELS.balanced.idleMs,
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

// Restart the transcription session (new language hint and/or silence setting). The
// mic keeps running; only the transcription stream is reset. Clears any half-assembled
// sentence so it can't leak across the restart.
let switching = false;
async function restartTranscription() {
  assembler.reset();
  liveSegment = "";
  store.current = null;
  conn = "切换中…";
  render();
  try {
    await stopTranscription();
    await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
    conn = "已连接，正在听…";
  } catch (e) {
    conn = `切换失败: ${e}`;
  }
  render();
}

// Switch practice <-> interview. `switching` guards a fast double-toggle.
async function toggleMode() {
  if (switching) return;
  switching = true;
  mode = mode === "practice" ? "interview" : "practice";
  try {
    await restartTranscription();
  } finally {
    switching = false;
  }
}

// Cycle the sensitivity preset (fast → balanced → full). Updates the assembler's idle
// timeout immediately and restarts the session with the new silence setting.
async function cycleLevel() {
  if (switching) return;
  switching = true;
  level = LEVEL_ORDER[(LEVEL_ORDER.indexOf(level) + 1) % LEVEL_ORDER.length];
  assembler.setIdleMs(LEVELS[level].idleMs);
  try {
    await restartTranscription();
  } finally {
    switching = false;
  }
}

// --- Copy to clipboard (per-line + copy-all) with a transient toast ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl); // outside #app so re-renders don't drop it
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.classList.remove("show"), 1100);
}
async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("✓ 已复制");
  } catch {
    showToast("复制失败");
  }
}
function copyLine(id: number, field: "orig" | "trans") {
  const u = store.history.find((x) => x.id === id);
  if (!u) return;
  const text = field === "orig" ? u.source : u.translation;
  if (text) void writeClipboard(text);
}
function copyAll() {
  // oldest first; each sentence as original + translation, blank line between.
  const text = [...store.history]
    .reverse()
    .map((u) => (u.translation ? `${u.source}\n${u.translation}` : u.source))
    .join("\n\n");
  if (text) void writeClipboard(text);
  else showToast("没有可复制的字幕");
}

// One delegated mousedown handler on the stable root. We use mousedown (not click)
// for BOTH actions because the overlay rebuilds innerHTML every ~340ms while you
// speak — a click (mousedown+mouseup on the SAME node) would be lost when the node
// is replaced mid-gesture.
root.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  const copyEl = target.closest("[data-action='copy']") as HTMLElement | null;
  if (copyEl) {
    copyLine(Number(copyEl.dataset.id), copyEl.dataset.field === "trans" ? "trans" : "orig");
    return;
  }
  if (target.closest("[data-action='copy-all']")) {
    copyAll();
    return;
  }
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
  if (target.closest("[data-action='cycle-level']")) {
    void cycleLevel();
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

  await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
  conn = "已连接，正在听…";
  render();

  await capture.start(onFrame);
}

main().catch((e) => {
  conn = `启动失败: ${e}`;
  render();
});
