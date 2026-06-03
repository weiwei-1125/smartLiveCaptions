// Dev-only preview of the caption overlay with mock data (no Tauri IPC).
// Load at http://localhost:1420/overlay-preview.html and call window.setMode("zh2en"|"en2zh").
import "../styles.css";
import { CaptionStore } from "../state/captionStore";
import { renderOverlay } from "../ui/overlay";
import { createMicFab } from "../ui/micFab";
import { openSettings } from "../ui/settings";
import type { Mode } from "../types";

const root = document.getElementById("app")!;
const label = document.getElementById("label")!;

// styles.css makes html/body transparent (for the real overlay); give the preview a
// visible desktop-like backdrop so the bar is readable. Inline style wins over the import.
document.body.style.background = "linear-gradient(135deg,#2a3f5f 0%,#3b2f55 100%)";
document.body.style.minHeight = "100vh";

function sampleStore(mode: Mode): CaptionStore {
  const s = new CaptionStore({ maxHistory: 200 });
  if (mode === "zh2en") {
    const pairs: [string, string][] = [
      ["我最近在学英语", "I've been learning English lately."],
      ["每天都会练习口语", "I practice speaking every day."],
      ["希望能找到一份好工作", "I hope I can find a good job."],
      ["这个方案风险有点大", "This plan is a bit too risky."],
      ["我们改到下周三吧", "Let's push it to next Wednesday."],
    ];
    for (const [zh, en] of pairs) {
      const id = s.commit(zh, "zh");
      s.setTranslation(id, en);
    }
    s.commit("Hello there.", "en"); // English in practice mode → passthrough, no translation
    s.setPartial("今天天气真不错", "zh"); // live, streaming (blue + cursor)
  } else {
    let id = s.commit("Thanks for joining us today.", "en");
    s.setTranslation(id, "感谢你今天参加。");
    id = s.commit("Can you walk me through a project you led?", "en");
    s.setTranslation(id, "你能讲一个你主导过的项目吗？");
    s.setPartial("Sure, let me think for a second.", "en"); // live
  }
  return s;
}

function show(mode: Mode) {
  label.textContent = `Overlay preview · mode = ${mode}`;
  renderOverlay(root, sampleStore(mode), { statusText: "已连接", statusKind: "ok", mode, level: "balanced", onTop: true, fontLevel: 1 });
}

(window as unknown as { setMode: (m: Mode) => void }).setMode = show;
// Preview the settings modal: window.openKeySettings("sk-proj-...") to eyeball styling.
(window as unknown as { openKeySettings: (key?: string) => void }).openKeySettings = (key?: string) =>
  openSettings({
    onSave: () => {},
    dismissable: true,
    currentKey: key,
    hotkey: { current: "Pause", onSet: async () => null, onClear: async () => {} },
  });

// Status preview: window.setStatusPreview("⚠ 连接失败 · 点此重连", "error", "reconnect").
(window as unknown as { setStatusPreview: (t: string, k: "ok" | "pending" | "error", a?: "reconnect") => void }).setStatusPreview = (
  t,
  k,
  a,
) =>
  renderOverlay(root, sampleStore("zh2en"), {
    statusText: t,
    statusKind: k,
    statusAction: a,
    mode: "zh2en",
    level: "balanced",
    onTop: true,
    fontLevel: 1,
  });

// Floating mic FAB preview. window.setMic(on, active) to eyeball each state.
const fab = createMicFab(() => {});
fab.setVoiceActive(true); // default: on + hearing voice (green glow)
(window as unknown as { setMic: (on: boolean, active: boolean) => void }).setMic = (on, active) => {
  fab.setMicOn(on);
  fab.setVoiceActive(active);
};

show("zh2en");
