import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { renderOverlay } from "./ui/overlay";
import { createMicFab } from "./ui/micFab";
import { openSettings, closeSettings } from "./ui/settings";
import {
  startTranscription,
  stopTranscription,
  pushAudio,
  onSonioxResult,
  onConnError,
  onConnOpen,
  onConnLost,
  type SonioxResult,
} from "./services/transcription";
import { hasApiKey, getApiKey, setApiKey } from "./services/settings";
import { getSavedHotkey, saveHotkey, registerMuteHotkey, unregisterHotkey } from "./services/hotkey";
import { detectLang } from "./config/modes";
import { toSimplified } from "./config/simplify";
import { FONT_SCALES, DEFAULT_FONT_LEVEL } from "./config/fontScales";
import { PACE_DELAY_MS, clampPace, type Pace } from "./config/pace";
import { getCurrentWindow } from "@tauri-apps/api/window";

const root = document.getElementById("app")!;
// In-memory only (cleared on exit). Large enough to scroll back through a session.
const store = new CaptionStore({ maxHistory: 200 });

let micOn = true;
let onTop = true; // window starts always-on-top (matches tauri.conf alwaysOnTop); pin toggles it
let voiceActive = false; // mic is currently hearing your voice — drives the FAB glow

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

// "断句节奏": how eagerly Soniox closes a sentence. Remembered across launches; changing it
// reconnects the Soniox session with the new max_endpoint_delay_ms (quick).
let pace: Pace = clampPace(localStorage.getItem("capPace"));
function setPace(next: Pace) {
  if (next === pace) return;
  pace = next;
  localStorage.setItem("capPace", pace);
  render();
  if (started) void restartConnection();
}

// Topbar status: calm when ok, amber while connecting, red on error (detail shown on hover).
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
    onTop,
    fontLevel,
    pace,
  });
}
store.subscribe(render);
applyFontScale(); // apply the remembered caption size before the first paint

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();
// Floating mic toggle — the primary control, lives over the captions (not in the topbar).
const micFab = createMicFab(() => void toggleMic());

// Continuous streaming: forward EVERY frame to Soniox (it does its own semantic endpointing,
// so no client-side VAD gating). The VAD here only drives the FAB's voice-activity glow.
function onFrame(frame: Int16Array) {
  void pushAudio(frame);
  const speech = vad.process(frame);
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
      voiceActive = false;
    }
  } catch (e) {
    setStatus("麦克风错误", "error", String(e));
  }
  micFab.setMicOn(micOn);
  render();
}

// --- Soniox token stream → captions ---
// Soniox streams tokens with is_final (false = provisional/revisable, true = locked) and
// translation_status ("original" | "translation"). curOrig/curTrans accumulate the CURRENT
// sentence's locked text; non-final tokens are the live, revising tail. A <end> token marks
// the sentence boundary → commit it to history and start the next.
let curOrig = "";
let curTrans = "";
function resetCaptions() {
  curOrig = "";
  curTrans = "";
  store.current = null;
}
function handleSonioxResult(msg: SonioxResult) {
  markActivity(); // proves the link is alive — feeds the resume staleness check
  let pendOrig = "";
  let pendTrans = "";
  let commitNow = false;
  for (const tk of msg.tokens ?? []) {
    const raw = tk.text ?? "";
    if (raw === "<end>" || raw === "<fin>") {
      commitNow = true; // sentence/utterance boundary
      continue;
    }
    const text = toSimplified(raw); // Soniox already outputs Simplified; belt-and-suspenders
    if (tk.translation_status === "translation") {
      if (tk.is_final) curTrans += text;
      else pendTrans += text;
    } else if (tk.is_final) curOrig += text;
    else pendOrig += text;
  }
  // The live (in-progress) block = locked + provisional tail, for both lines.
  const liveOrig = (curOrig + pendOrig).trim();
  const liveTrans = (curTrans + pendTrans).trim();
  store.setLive(liveOrig, liveTrans, detectLang(liveOrig || "zh"));
  if (commitNow) {
    const orig = curOrig.trim();
    if (orig) store.commit(orig, detectLang(orig)); // keeps the translation set by setLive
    else store.current = null;
    curOrig = "";
    curTrans = "";
  }
}

// --- Copy to clipboard (per-line + copy-all) with a transient toast ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(msg: string) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
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
  const text = [...store.history]
    .reverse()
    .map((u) => (u.translation ? `${u.source}\n${u.translation}` : u.source))
    .join("\n\n");
  if (text) void writeClipboard(text);
  else showToast("没有可复制的字幕");
}

// One delegated mousedown handler on the stable root (mousedown survives the overlay's
// frequent innerHTML rebuilds, unlike click).
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
    onTop = !onTop;
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
    reconnectNow();
    return;
  }
  if (target.closest("[data-action='toggle-mic']")) {
    void toggleMic();
    return;
  }
  if (target.closest("[data-action='open-settings']")) {
    void showSettings(false);
    return;
  }
  const paceEl = target.closest("[data-action='set-pace']") as HTMLElement | null;
  if (paceEl) {
    setPace(clampPace(paceEl.dataset.pace ?? null));
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
  if (target.closest("[data-drag]")) {
    // setFocus before startDragging works around tauri-apps/tauri#11605.
    const win = getCurrentWindow();
    win.setFocus().finally(() => void win.startDragging().catch(() => {}));
  }
});

// Whether the pipeline (WS + mic) has been started. Gated on having a key.
let started = false;
async function startPipeline() {
  setStatus("连接中…", "pending");
  render();
  await startTranscription(PACE_DELAY_MS[pace]);
  started = true;
  render();
  await capture.start(onFrame);
}

// Restart the connection (e.g. after the key changes). Mic keeps running.
async function restartConnection() {
  clearReconnect();
  setStatus("连接中…", "pending");
  render();
  try {
    await stopTranscription();
    resetCaptions();
    await startTranscription(PACE_DELAY_MS[pace]);
  } catch (e) {
    setStatus("连接失败", "error", String(e), "reconnect");
  }
  render();
}

// --- Connection self-healing: auto-reconnect on any unexpected drop, a clickable manual
// retry, and reconnect-on-resume after the machine wakes from sleep. ---
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
let lastActivity = 0;
const RECONNECT_MAX = 30000;
const STALE_MS = 90000;

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

async function doReconnect() {
  if (!started) return;
  try {
    await stopTranscription();
    resetCaptions();
    await startTranscription(PACE_DELAY_MS[pace]);
  } catch (e) {
    connDetail = String(e);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!started || reconnectTimer) return;
  reconnectAttempts++;
  const escalated = reconnectAttempts >= 4;
  setStatus(escalated ? "连接失败" : "重连中…", escalated ? "error" : "pending", connDetail, "reconnect");
  render();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void doReconnect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
}

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

function ensureConnected() {
  if (!started) return;
  if (connKind !== "ok" || performance.now() - lastActivity > STALE_MS) reconnectNow();
}

// Opt-in global mute hotkey (registered only when the user sets one; toggles the mic even
// when the app is backgrounded).
let activeHotkey = "";
async function applyHotkey(accel: string): Promise<string | null> {
  if (activeHotkey) {
    await unregisterHotkey(activeHotkey);
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

// Settings modal: the user's Soniox key (+ the optional global mute hotkey). firstRun = no
// key yet → can't be dismissed.
async function showSettings(firstRun: boolean) {
  const currentKey = firstRun ? "" : await getApiKey().catch(() => "");
  const savedHotkey = await getSavedHotkey().catch(() => "");
  openSettings({
    dismissable: !firstRun,
    currentKey,
    onSave: async (key) => {
      await setApiKey(key); // persist the Soniox key + apply live
      if (!started) await startPipeline();
      else await restartConnection();
      closeSettings();
    },
    hotkey: {
      current: savedHotkey,
      onSet: async (accel) => {
        const err = await applyHotkey(accel);
        if (!err) await saveHotkey(accel);
        return err;
      },
      onClear: async () => {
        await applyHotkey("");
        await saveHotkey("");
      },
    },
  });
}

async function main() {
  render();

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
    connDetail = msg;
    console.warn(`[conn] ${msg}`);
  });

  await onSonioxResult(handleSonioxResult);

  // Reconnect-on-resume after the machine wakes from sleep.
  window.addEventListener("focus", ensureConnected);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureConnected();
  });

  const savedHotkey = await getSavedHotkey().catch(() => "");
  if (savedHotkey) {
    const err = await applyHotkey(savedHotkey);
    if (err) console.warn(`[hotkey] ${err}`);
  }

  if (await hasApiKey()) {
    await startPipeline();
  } else {
    setStatus("请先设置 Soniox Key", "pending");
    render();
    void showSettings(true);
  }
}

main().catch((e) => {
  setStatus("启动失败", "error", String(e));
  render();
});
