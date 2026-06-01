import type { CaptionStore } from "../state/captionStore";
import type { Utterance, Mode } from "../types";

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

function modeLabel(mode: Mode): string {
  return mode === "practice" ? "🗣️ 练口语 中→英" : "🎧 面试 英→中";
}

export interface OverlayChrome {
  statusText: string;
  mode: Mode;
  micOn: boolean;
}

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

  // Top bar: ⠿ drag handle (data-drag → startDragging in main.ts) + mic / mode / close.
  // The buttons are siblings of the drag handle so they stay clickable.
  const micBtn = `<button class="ctl mic ${chrome.micOn ? "on" : "off"}" data-action="toggle-mic" title="收音开关">${chrome.micOn ? "🎤 收音" : "🔇 已停"}</button>`;
  const modeBtn = `<button class="ctl mode" data-action="toggle-mode" title="切换模式">${modeLabel(chrome.mode)}</button>`;
  const closeBtn = `<button class="ctl close" data-action="close" title="退出">✕</button>`;
  const topbar = `<div class="topbar">
    <span class="drag" data-drag>⠿ ${escapeHtml(chrome.statusText)}</span>
    ${micBtn}${modeBtn}${closeBtn}
  </div>`;

  root.innerHTML = `<div class="bar">${topbar}<div class="captions">${blocks.join("")}</div></div>`;

  // Restore scroll: stay pinned to the newest if we were at the bottom; otherwise
  // keep the user's position so they can read history undisturbed while new text streams in.
  const cap = root.querySelector(".captions") as HTMLElement | null;
  if (cap) cap.scrollTop = pinBottom ? cap.scrollHeight : prevTop;
}
