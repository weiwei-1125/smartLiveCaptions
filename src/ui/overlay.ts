import type { CaptionStore } from "../state/captionStore";
import type { Utterance, Mode } from "../types";

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// Monochrome copy glyph (inherits the button's `color` via currentColor, so it stays
// muted at rest and brightens on hover — unlike a 📋 emoji, which ignores CSS color).
const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

function copyBtn(id: number, field: "orig" | "trans", label: string): string {
  return `<button class="copy" data-action="copy" data-id="${id}" data-field="${field}" title="${label}">${COPY_ICON}</button>`;
}

function blockHtml(u: Utterance, live: boolean): string {
  const origClass = u.sourceLang === "zh" ? "orig zh" : "orig en";
  const cursor = live ? '<span class="cursor"></span>' : "";
  // Per-line copy buttons reveal on hover (committed lines only, not the live one).
  const origCopy = live ? "" : copyBtn(u.id, "orig", "复制原文");
  const origLine = `<div class="${origClass}"><span class="txt">${escapeHtml(u.source)}${cursor}</span>${origCopy}</div>`;
  let transLine = "";
  if (u.translation) {
    const transCopy = live ? "" : copyBtn(u.id, "trans", "复制译文");
    transLine = `<div class="trans"><span class="txt">${escapeHtml(u.translation)}</span>${transCopy}</div>`;
  }
  return `<div class="blk${live ? " live" : ""}">${origLine}${transLine}</div>`;
}

function modeLabel(mode: Mode): string {
  return mode === "zh2en" ? "🔄 中→英" : "🔄 英→中";
}

// Sensitivity presets shown as a segmented control (current one highlighted).
const LEVEL_SEGMENTS: Array<{ key: string; label: string }> = [
  { key: "fast", label: "快" },
  { key: "balanced", label: "平衡" },
  { key: "full", label: "整句" },
];

export interface OverlayChrome {
  statusText: string;
  mode: Mode;
  micOn: boolean;
  level: string; // active sensitivity key: "fast" | "balanced" | "full"
  onTop: boolean; // window is always-on-top (pinned)
  voiceActive: boolean; // mic is currently picking up your voice (drives the activity dot)
}

// Mic glyphs (monochrome SVG, same language as the copy/eye/window icons). Off is a
// slashed *microphone* — not a speaker — so it reads as "mic muted", not "sound off".
const ICON_MIC =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
const ICON_MIC_OFF =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-1m14 0v1a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';

// Monochrome window-control glyphs (inherit currentColor, same language as the copy/eye icons).
const ICON_PIN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="15" x2="12" y2="22"/><path d="M9 3h6l-1 7 2 2v3H8v-3l2-2-1-7z"/></svg>';
const ICON_MIN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
const ICON_MAX =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>';

// Distance (px) from the bottom within which we consider the user "pinned" to the
// newest caption, so new text keeps auto-scrolling to the bottom.
const PIN_THRESHOLD = 48;

export function renderOverlay(root: HTMLElement, store: CaptionStore, chrome: OverlayChrome): void {
  // Capture scroll state BEFORE we rebuild innerHTML so we can restore it after.
  const prevCap = root.querySelector(".captions") as HTMLElement | null;
  const pinBottom =
    !prevCap || prevCap.scrollHeight - prevCap.scrollTop - prevCap.clientHeight < PIN_THRESHOLD;
  const prevTop = prevCap ? prevCap.scrollTop : 0;

  const blocks: string[] = [];
  // oldest at top, newest/current at bottom
  for (const u of [...store.history].reverse()) blocks.push(blockHtml(u, false));
  if (store.current) blocks.push(blockHtml(store.current, true));

  // Icon-forward top bar. The ⠿ handle (data-drag) is the only drag region; the
  // buttons are siblings so they stay clickable.
  const micBtn = `<button class="ctl mic ${chrome.micOn ? "on" : "off"}" data-action="toggle-mic" title="${chrome.micOn ? "收音中（点击暂停）" : "已停（点击恢复）"}">${chrome.micOn ? ICON_MIC : ICON_MIC_OFF}</button>`;
  const modeBtn = `<button class="ctl mode" data-action="toggle-mode" title="切换翻译方向（中 ↔ 英）">${modeLabel(chrome.mode)}</button>`;
  const seg = `<div class="seg" title="灵敏度：快=最跟手出字 / 整句=最完整不切碎">${LEVEL_SEGMENTS.map(
    (s) => `<button class="seg-item${s.key === chrome.level ? " active" : ""}" data-action="set-level" data-level="${s.key}">${s.label}</button>`,
  ).join("")}</div>`;
  const copyAllBtn = `<button class="ctl" data-action="copy-all" title="复制全部对话（中英）">📋</button>`;
  const clearBtn = `<button class="ctl clear" data-action="clear" title="清除字幕">🧹</button>`;
  const settingsBtn = `<button class="ctl" data-action="open-settings" title="设置 API Key">⚙️</button>`;
  // Window controls (Windows-like), grouped at the far right. Pin toggles always-on-top.
  const pinBtn = `<button class="ctl winop pin${chrome.onTop ? " active" : ""}" data-action="toggle-pin" title="${chrome.onTop ? "已置顶（点击取消）" : "未置顶（点击置顶）"}">${ICON_PIN}</button>`;
  const minBtn = `<button class="ctl winop" data-action="minimize" title="最小化">${ICON_MIN}</button>`;
  const maxBtn = `<button class="ctl winop" data-action="toggle-maximize" title="最大化 / 还原">${ICON_MAX}</button>`;
  const closeBtn = `<button class="ctl winop close" data-action="close" title="退出">✕</button>`;
  const winctl = `<span class="winctl">${pinBtn}${minBtn}${maxBtn}${closeBtn}</span>`;
  // Voice-activity dot: lights green + pulses while your voice is being picked up,
  // dims to grey when silent. Replaces the old "🎤 <frames>" debug counter and removes
  // the duplicate mic glyph (the mic now appears only on the toggle button).
  const vadDot = `<span class="vad-dot${chrome.voiceActive ? " active" : ""}" title="${chrome.voiceActive ? "正在听到你说话" : "未检测到语音"}"></span>`;
  const topbar = `<div class="topbar">
    <span class="drag" data-drag>⠿ ${escapeHtml(chrome.statusText)}${vadDot}</span>
    ${seg}${micBtn}${modeBtn}${copyAllBtn}${clearBtn}${settingsBtn}${winctl}
  </div>`;

  root.innerHTML = `<div class="bar">${topbar}<div class="captions">${blocks.join("")}</div></div>`;

  // Restore scroll: stay pinned to the newest if we were at the bottom; otherwise
  // keep the user's position so they can read history undisturbed while new text streams in.
  const cap = root.querySelector(".captions") as HTMLElement | null;
  if (cap) cap.scrollTop = pinBottom ? cap.scrollHeight : prevTop;
}
