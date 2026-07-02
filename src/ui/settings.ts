// A small modal for entering the user's own Soniox API key (and the optional global
// mute hotkey). Appended to <body> (outside #app) so it survives the overlay's frequent
// innerHTML re-renders — the input keeps focus/text while captions stream underneath.

import { buildAccelerator } from "../config/accelerator";

/** Opt-in global mute hotkey controls (omit to hide the whole section). */
export interface HotkeySettings {
  /** Saved accelerator ("" = none configured / feature off). */
  current: string;
  /** Try to register+save `accel`. Resolve null on success, or an error string (e.g. taken). */
  onSet: (accel: string) => Promise<string | null>;
  /** Unregister + clear the hotkey. */
  onClear: () => Promise<void>;
}

export interface OpenSettingsOpts {
  /** Persist the keys. `llmKey` may be "" (polish feature off). May be async;
   * throwing/rejecting keeps the modal open with the error. */
  onSave: (key: string, llmKey: string) => void | Promise<void>;
  onCancel?: () => void;
  /** false on first run (no key yet) → no way to dismiss without setting a key. */
  dismissable: boolean;
  /** Prefill (e.g. when editing an existing key). */
  currentKey?: string;
  /** Prefill for the optional OpenAI polish key ("" = feature off). */
  currentLlmKey?: string;
  /** When present, render the opt-in global mute hotkey section. */
  hotkey?: HotkeySettings;
}

// Feather-style monochrome eye / eye-off glyphs (inherit currentColor like the copy icon).
const EYE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

let modalEl: HTMLDivElement | null = null;
let recordCleanup: (() => void) | null = null; // tears down an in-progress hotkey recording

export function closeSettings(): void {
  recordCleanup?.();
  recordCleanup = null;
  modalEl?.remove();
  modalEl = null;
}

const hotkeyLabel = (accel: string) => (accel ? accel : "未设置");

export function openSettings(opts: OpenSettingsOpts): void {
  closeSettings(); // single instance

  const el = document.createElement("div");
  el.className = "settings-modal";
  el.setAttribute("data-settings", "");
  const cancelBtn = opts.dismissable
    ? `<button class="ctl" data-action="cancel-settings">取消</button>`
    : "";
  const hotkeySection = opts.hotkey
    ? `<div class="hotkey-sec">
        <div class="settings-subtitle">全局静音热键（可选）</div>
        <div class="settings-hint">默认无。设一个键后，即使 app 在后台也能一键静音/恢复。<br>推荐 <b>Pause</b> 键——几乎不和其它软件冲突；若提示被占用，换一个即可。</div>
        <div class="hotkey-row">
          <span class="hotkey-current" data-hotkey-current>当前：${hotkeyLabel(opts.hotkey.current)}</span>
          <button class="ctl" data-action="record-hotkey" type="button">录制</button>
          <button class="ctl" data-action="clear-hotkey" type="button">清除</button>
        </div>
        <div class="hotkey-status" data-hotkey-status></div>
      </div>`
    : "";
  el.innerHTML = `
    <div class="settings-card">
      <div class="settings-title">设置 Soniox API Key</div>
      <div class="settings-hint">在 console.soniox.com 创建你自己的 key。<br>只保存在本机，不会上传，也不在软件里预置。</div>
      <div class="key-field">
        <input type="password" placeholder="sk-..." spellcheck="false" autocomplete="off" />
        <button class="reveal" data-action="toggle-reveal" type="button" tabindex="-1" title="显示">${EYE}</button>
      </div>
      <div class="settings-subtitle">英文口语润色（可选）</div>
      <div class="settings-hint">填入你的 OpenAI API Key（platform.openai.com），中文句子会多出一行更口语的英文说法；留空则不启用。</div>
      <div class="key-field">
        <input type="password" data-llm-key placeholder="sk-...（可留空）" spellcheck="false" autocomplete="off" />
        <button class="reveal" data-action="toggle-reveal" type="button" tabindex="-1" title="显示">${EYE}</button>
      </div>
      <div class="err"></div>
      ${hotkeySection}
      <div class="settings-actions">${cancelBtn}<button class="ctl save" data-action="save-key">保存并开始</button></div>
    </div>`;
  document.body.appendChild(el);
  modalEl = el;

  const input = el.querySelector("input:not([data-llm-key])") as HTMLInputElement;
  const llmInput = el.querySelector("input[data-llm-key]") as HTMLInputElement;
  const errEl = el.querySelector(".err") as HTMLElement;
  if (opts.currentKey) input.value = opts.currentKey;
  if (opts.currentLlmKey) llmInput.value = opts.currentLlmKey;
  input.focus();

  const save = async () => {
    const key = input.value.trim();
    if (!key) {
      errEl.textContent = "请输入 API Key";
      return;
    }
    errEl.textContent = "";
    try {
      await opts.onSave(key, llmInput.value.trim());
    } catch (e) {
      errEl.textContent = `保存失败：${e}`;
    }
  };

  // Custom show/hide toggles (the native WebView password reveal is suppressed in CSS) —
  // one per key field, each wired to the input inside its own .key-field.
  for (const revealBtn of el.querySelectorAll<HTMLButtonElement>("[data-action='toggle-reveal']")) {
    const field = revealBtn.closest(".key-field")?.querySelector("input") as HTMLInputElement;
    revealBtn.addEventListener("click", () => {
      const masked = field.type === "password";
      field.type = masked ? "text" : "password";
      revealBtn.innerHTML = masked ? EYE_OFF : EYE;
      revealBtn.title = masked ? "隐藏" : "显示";
      field.focus();
    });
  }

  (el.querySelector("[data-action='save-key']") as HTMLElement).addEventListener("click", () => void save());
  for (const inp of [input, llmInput]) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void save();
    });
  }
  if (opts.dismissable) {
    (el.querySelector("[data-action='cancel-settings']") as HTMLElement).addEventListener("click", () => {
      closeSettings();
      opts.onCancel?.();
    });
  }

  // --- Optional opt-in global mute hotkey ---
  if (opts.hotkey) {
    const hk = opts.hotkey;
    const currentEl = el.querySelector("[data-hotkey-current]") as HTMLElement;
    const statusEl = el.querySelector("[data-hotkey-status]") as HTMLElement;
    const recordBtn = el.querySelector("[data-action='record-hotkey']") as HTMLButtonElement;
    const clearBtn = el.querySelector("[data-action='clear-hotkey']") as HTMLButtonElement;

    const stopRecording = () => {
      recordCleanup?.();
      recordCleanup = null;
      recordBtn.textContent = "录制";
      recordBtn.classList.remove("recording");
    };
    const startRecording = () => {
      recordCleanup?.();
      recordBtn.textContent = "按下快捷键…";
      recordBtn.classList.add("recording");
      statusEl.className = "hotkey-status";
      statusEl.textContent = "等待你按下组合键（Esc 取消）";
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") {
          stopRecording();
          statusEl.textContent = "已取消";
          return;
        }
        const accel = buildAccelerator(e);
        if (!accel) return; // incomplete (e.g. only a modifier down) — keep waiting
        stopRecording();
        statusEl.className = "hotkey-status";
        statusEl.textContent = `注册中：${accel}…`;
        void hk.onSet(accel).then((err) => {
          if (err) {
            statusEl.className = "hotkey-status err";
            statusEl.textContent = err;
          } else {
            currentEl.textContent = `当前：${accel}`;
            statusEl.className = "hotkey-status ok";
            statusEl.textContent = `已生效：${accel}`;
          }
        });
      };
      document.addEventListener("keydown", onKey, true);
      recordCleanup = () => document.removeEventListener("keydown", onKey, true);
    };

    recordBtn.addEventListener("click", () => {
      if (recordCleanup) stopRecording();
      else startRecording();
    });
    clearBtn.addEventListener("click", () => {
      stopRecording();
      void hk.onClear().then(() => {
        currentEl.textContent = "当前：未设置";
        statusEl.className = "hotkey-status";
        statusEl.textContent = "已清除";
      });
    });
  }
}
