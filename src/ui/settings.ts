// A small modal for entering the user's own OpenAI API key. Appended to <body>
// (outside #app) so it survives the overlay's frequent innerHTML re-renders — the
// input keeps focus/text while captions stream underneath.

export interface OpenSettingsOpts {
  /** Persist the key. May be async; throwing/rejecting keeps the modal open with the error. */
  onSave: (key: string) => void | Promise<void>;
  onCancel?: () => void;
  /** false on first run (no key yet) → no way to dismiss without setting a key. */
  dismissable: boolean;
  /** Prefill (e.g. when editing an existing key). */
  currentKey?: string;
}

// Feather-style monochrome eye / eye-off glyphs (inherit currentColor like the copy icon).
const EYE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

let modalEl: HTMLDivElement | null = null;

export function closeSettings(): void {
  modalEl?.remove();
  modalEl = null;
}

export function openSettings(opts: OpenSettingsOpts): void {
  closeSettings(); // single instance

  const el = document.createElement("div");
  el.className = "settings-modal";
  el.setAttribute("data-settings", "");
  const cancelBtn = opts.dismissable
    ? `<button class="ctl" data-action="cancel-settings">取消</button>`
    : "";
  el.innerHTML = `
    <div class="settings-card">
      <div class="settings-title">设置 OpenAI API Key</div>
      <div class="settings-hint">在 platform.openai.com 创建你自己的 key（以 sk- 开头）。<br>只保存在本机，不会上传，也不在软件里预置。</div>
      <div class="key-field">
        <input type="password" placeholder="sk-..." spellcheck="false" autocomplete="off" />
        <button class="reveal" data-action="toggle-reveal" type="button" tabindex="-1" title="显示">${EYE}</button>
      </div>
      <div class="err"></div>
      <div class="settings-actions">${cancelBtn}<button class="ctl save" data-action="save-key">保存并开始</button></div>
    </div>`;
  document.body.appendChild(el);
  modalEl = el;

  const input = el.querySelector("input") as HTMLInputElement;
  const errEl = el.querySelector(".err") as HTMLElement;
  if (opts.currentKey) input.value = opts.currentKey;
  input.focus();

  const save = async () => {
    const key = input.value.trim();
    if (!key) {
      errEl.textContent = "请输入 API Key";
      return;
    }
    errEl.textContent = "";
    try {
      await opts.onSave(key);
    } catch (e) {
      errEl.textContent = `保存失败：${e}`;
    }
  };

  // Custom show/hide toggle (the native WebView password reveal is suppressed in CSS).
  const revealBtn = el.querySelector("[data-action='toggle-reveal']") as HTMLButtonElement;
  revealBtn.addEventListener("click", () => {
    const masked = input.type === "password";
    input.type = masked ? "text" : "password";
    revealBtn.innerHTML = masked ? EYE_OFF : EYE;
    revealBtn.title = masked ? "隐藏" : "显示";
    input.focus();
  });

  (el.querySelector("[data-action='save-key']") as HTMLElement).addEventListener("click", () => void save());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void save();
  });
  if (opts.dismissable) {
    (el.querySelector("[data-action='cancel-settings']") as HTMLElement).addEventListener("click", () => {
      closeSettings();
      opts.onCancel?.();
    });
  }
}
