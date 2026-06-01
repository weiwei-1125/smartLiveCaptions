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
}

export function renderOverlay(root: HTMLElement, store: CaptionStore, chrome: OverlayChrome): void {
  const blocks: string[] = [];
  // oldest at top, newest/current at bottom
  for (const u of [...store.history].reverse()) blocks.push(blockHtml(u, false));
  if (store.current) blocks.push(blockHtml(store.current, true));

  // The ⠿ handle (data-drag) starts a window drag via startDragging() (wired in
  // main.ts) — more reliable than data-tauri-drag-region. The mode button is a
  // sibling so it stays clickable and toggles practice/interview.
  const topbar = `<div class="topbar">
    <span class="drag" data-drag>⠿ ${escapeHtml(chrome.statusText)}</span>
    <button class="mode" data-action="toggle-mode" title="切换模式">${modeLabel(chrome.mode)}</button>
  </div>`;

  root.innerHTML = `<div class="bar">${topbar}${blocks.join("")}</div>`;
}
