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
  onConnOpen,
  onConnLost,
} from "./services/transcription";
import { translate } from "./services/translation";
import { hasApiKey, getApiKey, setApiKey } from "./services/settings";
import { getSavedHotkey, saveHotkey, registerMuteHotkey, unregisterHotkey } from "./services/hotkey";
import { planUtterance, detectLang, transcriptionLangHint } from "./config/modes";
import { toSimplified } from "./config/simplify";
import { FONT_SCALES, DEFAULT_FONT_LEVEL } from "./config/fontScales";
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

// Caption font size: an index into FONT_SCALES, remembered across launches via localStorage.
function clampFont(n: number): number {
  if (!Number.isFinite(n)) n = DEFAULT_FONT_LEVEL;
  return Math.max(0, Math.min(FONT_SCALES.length - 1, Math.round(n)));
}
let fontLevel = clampFont(Number(localStorage.getItem("capFontLevel") ?? DEFAULT_FONT_LEVEL));
function applyFontScale() {
  document.body.style.setProperty("--cap-scale", String(FONT_SCALES[fontLevel]));
}
function setFontLevel(delta: number) {
  const next = clampFont(fontLevel + delta);
  if (next === fontLevel) return;
  fontLevel = next;
  localStorage.setItem("capFontLevel", String(fontLevel));
  applyFontScale();
  render();
}

// Topbar status: calm when ok, amber while connecting, red on error (detail shown on hover).
// statusAction = "reconnect" makes the status a clickable retry button.
let connText = "启动中…";
let connKind: "ok" | "pending" | "error" = "pending";
let connDetail = "";
let connAction: "reconnect" | undefined;
function setStatus(text: string, kind: "ok" | "pending" | "error", detail = "", action?: "reconnect") {
  connText = text;
  connKind = kind;
  connDetail = detail;
  connAction = action;
}

function render() {
  renderOverlay(root, store, {
    statusText: connText,
    statusKind: connKind,
    statusDetail: connDetail,
    statusAction: connAction,
    mode,
    level,
    onTop,
    fontLevel,
  });
}
store.subscribe(render);
applyFontScale(); // apply the remembered caption size before the first paint

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
    setStatus("麦克风错误", "error", String(e));
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
  clearReconnect(); // an intentional restart supersedes any pending auto-reconnect
  assembler.reset();
  liveSegment = "";
  store.current = null;
  setStatus("连接中…", "pending");
  render();
  try {
    await stopTranscription();
    await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
    // "已连接" is confirmed by the conn_open event
  } catch (e) {
    setStatus("连接失败", "error", `切换失败: ${e}`, "reconnect");
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
  if (target.closest("[data-action='reconnect']")) {
    reconnectNow(); // clicking the status while disconnected retries immediately
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
  if (target.closest("[data-action='font-smaller']")) {
    setFontLevel(-1);
    return;
  }
  if (target.closest("[data-action='font-bigger']")) {
    setFontLevel(1);
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
  setStatus("连接中…", "pending");
  render();
  await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
  started = true;
  // "已连接" is confirmed by the conn_open event; reconnect is handled below.
  render();
  await capture.start(onFrame);
}

// --- Connection self-healing: auto-reconnect on any unexpected drop, a clickable manual
// retry, and reconnect-on-resume after the machine wakes from sleep. ---
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000; // exponential backoff, capped at RECONNECT_MAX
let reconnectAttempts = 0;
let lastActivity = 0; // performance.now() of the last conn_open / transcript
const RECONNECT_MAX = 30000;
const STALE_MS = 90000; // on resume, if quiet this long, assume the link died → reconnect

const markActivity = () => {
  lastActivity = performance.now();
};
function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1000;
  reconnectAttempts = 0;
}

// Tear down the (possibly dead) session and open a fresh one. Success/failure arrives
// asynchronously via the conn_open / conn_lost events.
async function doReconnect() {
  if (!started) return;
  try {
    await stopTranscription();
    await startTranscription(transcriptionLangHint(mode), LEVELS[level].silenceMs);
  } catch (e) {
    connDetail = String(e);
    scheduleReconnect(); // the IPC itself failed — back off and try again
  }
}

// Called on conn_lost: show progress and retry with growing backoff (never gives up).
function scheduleReconnect() {
  if (!started || reconnectTimer) return;
  reconnectAttempts++;
  const escalated = reconnectAttempts >= 4; // a few quick tries failed → make it red + obvious
  setStatus(
    escalated ? "连接失败" : "重连中…",
    escalated ? "error" : "pending",
    connDetail,
    "reconnect",
  );
  render();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void doReconnect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

// Manual retry (clicking the status) or focus-resume: reconnect right now, reset backoff.
function reconnectNow() {
  if (!started) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectDelay = 1000;
  setStatus("重连中…", "pending", connDetail, "reconnect");
  render();
  void doReconnect();
}

// On window resume (focus / tab visible): if we're disconnected, or it's been quiet for a
// long time (an undetected drop after sleep), reconnect immediately.
function ensureConnected() {
  if (!started) return;
  if (connKind !== "ok" || performance.now() - lastActivity > STALE_MS) reconnectNow();
}

// Opt-in global mute hotkey. activeHotkey = the accelerator we currently hold ("" = none).
// It's registered only when the user sets one (nothing is grabbed system-wide by default),
// and it toggles the mic even when the app is in the background.
let activeHotkey = "";
async function applyHotkey(accel: string): Promise<string | null> {
  if (activeHotkey) {
    await unregisterHotkey(activeHotkey); // drop the previous one first so re-recording is clean
    activeHotkey = "";
  }
  if (!accel) return null;
  try {
    await registerMuteHotkey(accel, () => void toggleMic());
    activeHotkey = accel;
    return null;
  } catch {
    return `「${accel}」注册失败，可能已被其它软件占用，请换一个`;
  }
}

// Open the API-key settings modal. firstRun = no key yet → the modal can't be dismissed
// (the app is useless without a key). On save we persist, then either kick off the
// pipeline (first run) or reconnect with the new key (changing it while running).
async function showSettings(firstRun: boolean) {
  // On reopen (gear), prefill the saved key + hotkey so the user sees what's configured.
  const currentKey = firstRun ? "" : await getApiKey().catch(() => "");
  const savedHotkey = await getSavedHotkey().catch(() => "");
  openSettings({
    dismissable: !firstRun,
    currentKey,
    onSave: async (key) => {
      await setApiKey(key); // persist to the per-user config + apply live (may throw)
      if (!started) await startPipeline();
      else await restartTranscription();
      closeSettings();
    },
    hotkey: {
      current: savedHotkey,
      onSet: async (accel) => {
        const err = await applyHotkey(accel); // register first; only persist if it took
        if (!err) await saveHotkey(accel);
        return err;
      },
      onClear: async () => {
        await applyHotkey(""); // unregisters
        await saveHotkey("");
      },
    },
  });
}

async function main() {
  render(); // render the bar immediately so the (transparent) window is visible

  // Connection lifecycle. conn_open confirms the link is live (and resets reconnect);
  // conn_lost (any unexpected drop) triggers auto-reconnect; conn_error is informational
  // (a server error message) — it doesn't itself change the connection state.
  await onConnOpen(() => {
    clearReconnect();
    markActivity();
    setStatus("已连接", "ok");
    render();
  });
  await onConnLost(() => {
    if (started) scheduleReconnect();
  });
  await onConnError((msg) => {
    connDetail = msg; // kept for the reconnect status' hover detail
    console.warn(`[conn] ${msg}`);
  });

  await onTranscript((m) => {
    markActivity(); // proves the link is alive — feeds the resume staleness check
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

  // Reconnect-on-resume: when the window regains focus or becomes visible (e.g. after the
  // machine wakes from sleep), reconnect if the link is down or has been quiet too long.
  window.addEventListener("focus", ensureConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureConnected();
  });

  // Re-register the saved global mute hotkey, if the user opted into one previously.
  const savedHotkey = await getSavedHotkey().catch(() => "");
  if (savedHotkey) {
    const err = await applyHotkey(savedHotkey);
    if (err) console.warn(`[hotkey] ${err}`); // taken now — user can re-set it in settings
  }

  if (await hasApiKey()) {
    await startPipeline();
  } else {
    setStatus("请先设置 API Key", "pending");
    render();
    void showSettings(true); // first run — must enter a key to continue
  }
}

main().catch((e) => {
  setStatus("启动失败", "error", String(e));
  render();
});
