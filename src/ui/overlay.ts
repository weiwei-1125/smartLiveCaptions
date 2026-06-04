import type { CaptionStore } from "../state/captionStore";
import type { Utterance } from "../types";
import { FONT_SCALES } from "../config/fontScales";
import { PACE_SEGMENTS, type Pace } from "../config/pace";

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

const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';

export interface OverlayChrome {
  statusText: string;
  statusKind: "ok" | "pending" | "error"; // calm when ok, amber when pending, red when error
  statusDetail?: string; // full message for hover (e.g. the error text)
  statusAction?: "reconnect"; // when set, the status becomes a clickable retry button
  onTop: boolean; // window is always-on-top (pinned)
  fontLevel: number; // index into FONT_SCALES (for disabling A−/A+ at the ends)
  pace: Pace; // "断句节奏" — which sentence-segmentation speed is active
}

// Monochrome window-control glyphs (inherit currentColor, same language as the copy/eye icons).
const ICON_PIN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="15" x2="12" y2="22"/><path d="M9 3h6l-1 7 2 2v3H8v-3l2-2-1-7z"/></svg>';
const ICON_MIN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
const ICON_MAX =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>';

// Action-button glyphs (same monochrome Feather language): lined clipboard for copy-all,
// a trash can for clear, a gear for settings, circular arrows for reconnect.
const ICON_COPY_ALL =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>';
const ICON_CLEAR =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const ICON_SETTINGS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

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
  // buttons are siblings so they stay clickable. (Mic lives in a floating FAB; translation
  // direction is automatic via Soniox two-way, so there's no mode/sensitivity control.)
  const copyAllBtn = `<button class="ctl iconbtn" data-action="copy-all" title="复制全部对话（中英）">${ICON_COPY_ALL}</button>`;
  const clearBtn = `<button class="ctl iconbtn clear" data-action="clear" title="清除字幕">${ICON_CLEAR}</button>`;
  const settingsBtn = `<button class="ctl iconbtn" data-action="open-settings" title="设置">${ICON_SETTINGS}</button>`;
  // "断句节奏" — how eagerly Soniox closes a sentence (max_endpoint_delay_ms). Remembered.
  const paceCtl = `<span class="seg" title="断句节奏">${PACE_SEGMENTS.map(
    (s) =>
      `<button class="seg-item${chrome.pace === s.pace ? " active" : ""}" data-action="set-pace" data-pace="${s.pace}" title="${s.title}">${s.label}</button>`,
  ).join("")}</span>`;
  // Caption font-size stepper (scales original + translation together; choice is remembered).
  const fontCtl = `<span class="fontctl" title="字幕字号">
    <button class="font-btn" data-action="font-smaller" title="缩小字号"${chrome.fontLevel <= 0 ? " disabled" : ""}>A−</button>
    <button class="font-btn" data-action="font-bigger" title="放大字号"${chrome.fontLevel >= FONT_SCALES.length - 1 ? " disabled" : ""}>A+</button>
  </span>`;
  // Window controls (Windows-like), grouped at the far right. Pin toggles always-on-top.
  const pinBtn = `<button class="ctl iconbtn pin${chrome.onTop ? " active" : ""}" data-action="toggle-pin" title="${chrome.onTop ? "已置顶（点击取消）" : "未置顶（点击置顶）"}">${ICON_PIN}</button>`;
  const minBtn = `<button class="ctl iconbtn" data-action="minimize" title="最小化">${ICON_MIN}</button>`;
  const maxBtn = `<button class="ctl iconbtn" data-action="toggle-maximize" title="最大化 / 还原">${ICON_MAX}</button>`;
  const closeBtn = `<button class="ctl iconbtn close" data-action="close" title="退出">${ICON_CLOSE}</button>`;
  const winctl = `<span class="winctl">${pinBtn}${minBtn}${maxBtn}${closeBtn}</span>`;
  // Status: calm when healthy, amber while connecting, red on error (detail on hover).
  // When disconnected (statusAction = reconnect), a refresh icon button appears next to it
  // (the reconnect affordance — the status text itself is not clickable).
  const statusTitle = escapeHtml(chrome.statusDetail || chrome.statusText);
  const status = `<span class="status status-${chrome.statusKind}" title="${statusTitle}">${escapeHtml(chrome.statusText)}</span>`;
  // Refresh button lives inside the drag region; clicking it reconnects (the mousedown
  // handler checks data-action='reconnect' before the drag), empty space still drags.
  const refreshBtn =
    chrome.statusAction === "reconnect"
      ? ` <button class="ctl iconbtn refresh" data-action="reconnect" title="重新连接">${ICON_REFRESH}</button>`
      : "";
  const topbar = `<div class="topbar">
    <span class="drag" data-drag>⠿ ${status}${refreshBtn}</span>
    ${paceCtl}${fontCtl}${copyAllBtn}${clearBtn}${settingsBtn}${winctl}
  </div>`;

  root.innerHTML = `<div class="bar">${topbar}<div class="captions">${blocks.join("")}</div></div>`;

  // Restore scroll: stay pinned to the newest if we were at the bottom; otherwise
  // keep the user's position so they can read history undisturbed while new text streams in.
  const cap = root.querySelector(".captions") as HTMLElement | null;
  if (cap) cap.scrollTop = pinBottom ? cap.scrollHeight : prevTop;
}
