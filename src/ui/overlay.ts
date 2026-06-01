import type { CaptionStore } from "../state/captionStore";
import type { Utterance } from "../types";

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

export function renderOverlay(root: HTMLElement, store: CaptionStore): void {
  const blocks: string[] = [];
  // oldest at top, newest/current at bottom
  for (const u of [...store.history].reverse()) blocks.push(blockHtml(u, false));
  if (store.current) blocks.push(blockHtml(store.current, true));
  root.innerHTML = `<div class="bar">${blocks.join("")}</div>`;
}
