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
      <input type="password" placeholder="sk-..." spellcheck="false" autocomplete="off" />
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
