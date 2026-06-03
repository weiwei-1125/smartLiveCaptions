import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { SentenceAssembler } from "./state/sentenceAssembler";
import { renderOverlay } from "./ui/overlay";
import { createMicFab } from "./ui/micFab";
import { openSettings, closeSettings } from "./ui/settings";
import {
  startTranscription,
  stopTranscription,
  pushAudio,
  onTranscript,
  onConnError,
} from "./services/transcription";
import { translate } from "./services/translation";
import { hasApiKey, getApiKey, setApiKey } from "./services/settings";
import { planUtterance, detectLang, transcriptionLangHint } from "./config/modes";
import { toSimplified } from "./config/simplify";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Mode } from "./types";

const root = document.getElementById("app")!;
// In-memory only (cleared on exit). Large enough to scroll back through a session.
const store = new CaptionStore({ maxHistory: 200 });

// Sensitivity presets. silenceMs = server VAD acoustic-commit boundary (smaller =
// text appears sooner); idleMs = how long the assembler holds a punctuation-less
// fragment before committing it (larger = a thinking pause won't split a sentence).
type Level = "fast" | "balanced" | "full";
const LEVELS: Record<Level, { silenceMs: number; idleMs: number }> = {
  fast: { silenceMs: 250, idleMs: 1200 },
  balanced: { silenceMs: 350, idleMs: 1600 },
  full: { silenceMs: 500, idleMs: 2400 },
};
let mode: Mode = "zh2en";
let micOn = true;
let level: Level = "balanced";
let onTop = true; // window starts always-on-top (matches tauri.conf alwaysOnTop); pin toggles it
let voiceActive = false; // mic is currently hearing your voice — drives the activity dot
let conn = "启动中…";

function statusText(): string {
  return conn;
}
function render() {
  renderOverlay(root, store, { statusText: statusText(), mode, level, onTop });
}
store.subscribe(render);

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();
// Floating mic toggle — the primary control, lives over the captions (not in the topbar).
// Kept in sync via setMicOn / setVoiceActive; clicking it toggles capture.
const micFab = createMicFab(() => void toggleMic());

// Gate mic frames through the VAD and forward speech to the transcription stream.
function onFrame(frame: Int16Array) {
  const speech = vad.process(frame);
  if (speech) void pushAudio(frame);
  // Drive the voice-activity dot directly (no full re-render) so it tracks your voice in
  // real time; the overlay itself re-renders on caption changes.
  if (speech !== voiceActive) {
    voiceActive = speech;
    micFab.setVoiceActive(voiceActive);
  }
}

// Mic on/off: releases the microphone when off (privacy + no audio uploaded).
async function toggleMic() {
  micOn = !micOn;
  try {
    if (micOn) await capture.start(onFrame);
    else {
      capture.stop();
      voiceActive = false; // no audio coming in → dot idle
    }
  } catch (e) {
    conn = `麦克风错误: ${e}`;
  }
  micFab.setMicOn(micOn);
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
    store.setTranslation(id, toSimplified(out)); // belt-and-suspenders: ensure Simplified
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

// Swap translation direction (中→英 <-> 英→中). `switching` guards a fast double-toggle.
async function toggleMode() {
  if (switching) return;
  switching = true;
  mode = mode === "zh2en" ? "en2zh" : "zh2en";
  try {
    await restartTranscription();
  } finally {
    switching = false;
  }
}

// Pick a sensitivity preset directly (segmented control). Updates the assembler's idle
// timeout immediately and restarts the session with the new silence setting.
async function setLevel(next: Level) {
  if (switching || next === level) return;
  switching = true;
  level = next;
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
  if (target.closest("[data-action='toggle-pin']")) {
    onTop = !onTop; // toggle always-on-top so the overlay can be sent behind other windows
    void getCurrentWindow().setAlwaysOnTop(onTop);
    render();
    return;
  }
  if (target.closest("[data-action='minimize']")) {
    void getCurrentWindow().minimize();
    return;
  }
  if (target.closest("[data-action='toggle-maximize']")) {
    void getCurrentWindow().toggleMaximize();
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
  if (target.closest("[data-action='open-settings']")) {
    void showSettings(false); // dismissable: changing the key while running
    return;
  }
  const segEl = target.closest("[data-action='set-level']") as HTMLElement | null;
  if (segEl) {
    void setLevel(segEl.dataset.level as Level);
    return;
  }
  if (target.closest("[data-drag]")) {
    // setFocus before startDragging works around tauri-apps/tauri#11605.
    // Requires the core:window:allow-start-dragging capability (capabilities/default.json).
    const win = getCurrentWindow();
    win.setFocus().finally(() => void win.startDragging().catch(() => {}));
  }
});

// Whether the transcription pipeline (WS + mic) has been started. Gated on having a
// key so we don't open a connection with an empty key on a fresh install.
let started = false;
async function startPipeline() {
  await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
  started = true;
  conn = "已连接，正在听…";
  render();
  await capture.start(onFrame);
}

// Open the API-key settings modal. firstRun = no key yet → the modal can't be dismissed
// (the app is useless without a key). On save we persist, then either kick off the
// pipeline (first run) or reconnect with the new key (changing it while running).
async function showSettings(firstRun: boolean) {
  // On reopen (gear), prefill the saved key so the user sees what's configured.
  const currentKey = firstRun ? "" : await getApiKey().catch(() => "");
  openSettings({
    dismissable: !firstRun,
    currentKey,
    onSave: async (key) => {
      await setApiKey(key); // persist to the per-user config + apply live (may throw)
      if (!started) await startPipeline();
      else await restartTranscription();
      closeSettings();
    },
  });
}

async function main() {
  render(); // render the bar immediately so the (transparent) window is visible

  await onConnError((msg) => {
    conn = `⚠️ 连接失败: ${msg}`;
    render();
  });

  await onTranscript((m) => {
    const text = toSimplified(m.text); // normalize any Traditional → Simplified
    if (m.kind === "partial") {
      liveSegment += text; // accumulate the current acoustic segment
      assembler.touch(); // speech in progress — keep the idle flush from firing
      refreshLive();
    } else if (m.kind === "final" && text.trim()) {
      liveSegment = ""; // segment done; its text is authoritative via the assembler
      assembler.feed(text); // splits into sentences / merges fragments → handleFinal
      refreshLive(); // show the in-progress remainder (or clear)
    }
  });

  if (await hasApiKey()) {
    await startPipeline();
  } else {
    conn = "请先设置 API Key ⚙️";
    render();
    void showSettings(true); // first run — must enter a key to continue
  }
}

main().catch((e) => {
  conn = `启动失败: ${e}`;
  render();
});
