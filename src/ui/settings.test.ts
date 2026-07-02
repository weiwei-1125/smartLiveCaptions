// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { openSettings, closeSettings } from "./settings";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("settings modal", () => {
  it("renders an api-key input and a save button", () => {
    openSettings({ onSave: () => {}, dismissable: true });
    expect(document.querySelector("[data-settings] input")).not.toBeNull();
    expect(document.querySelector("[data-action='save-key']")).not.toBeNull();
  });

  it("calls onSave with the entered key when save is clicked", () => {
    const saved: string[] = [];
    openSettings({ onSave: (k) => { saved.push(k); }, dismissable: true });
    const input = document.querySelector("[data-settings] input") as HTMLInputElement;
    input.value = "sk-typed-key";
    (document.querySelector("[data-action='save-key']") as HTMLElement).click();
    expect(saved).toEqual(["sk-typed-key"]);
  });

  it("does not call onSave when the input is empty (shows a hint instead)", () => {
    let called = false;
    openSettings({ onSave: () => { called = true; }, dismissable: true });
    const input = document.querySelector("[data-settings] input") as HTMLInputElement;
    input.value = "   ";
    (document.querySelector("[data-action='save-key']") as HTMLElement).click();
    expect(called).toBe(false);
    expect(document.querySelector("[data-settings] .err")!.textContent).toBeTruthy();
  });

  it("shows a cancel control when dismissable, hides it on first run", () => {
    openSettings({ onSave: () => {}, dismissable: true });
    expect(document.querySelector("[data-action='cancel-settings']")).not.toBeNull();
    closeSettings();
    openSettings({ onSave: () => {}, dismissable: false });
    expect(document.querySelector("[data-action='cancel-settings']")).toBeNull();
  });

  it("renders the global-hotkey section only when hotkey opts are provided", () => {
    openSettings({ onSave: () => {}, dismissable: true });
    expect(document.querySelector("[data-action='record-hotkey']")).toBeNull(); // off by default
    closeSettings();
    openSettings({
      onSave: () => {},
      dismissable: true,
      hotkey: { current: "", onSet: async () => null, onClear: async () => {} },
    });
    expect(document.querySelector("[data-action='record-hotkey']")).not.toBeNull();
    expect(document.querySelector("[data-action='clear-hotkey']")).not.toBeNull();
  });

  it("shows the currently configured hotkey", () => {
    openSettings({
      onSave: () => {},
      dismissable: true,
      hotkey: { current: "Pause", onSet: async () => null, onClear: async () => {} },
    });
    expect(document.querySelector("[data-hotkey-current]")!.textContent).toContain("Pause");
  });

  it("closeSettings removes the modal", () => {
    openSettings({ onSave: () => {}, dismissable: true });
    closeSettings();
    expect(document.querySelector("[data-settings]")).toBeNull();
  });

  it("prefills the input with the current key", () => {
    openSettings({ onSave: () => {}, dismissable: true, currentKey: "sk-current" });
    const input = document.querySelector("[data-settings] input") as HTMLInputElement;
    expect(input.value).toBe("sk-current");
  });

  it("renders the optional llm-key field, prefills it, and passes it to onSave", () => {
    const saved: Array<[string, string]> = [];
    openSettings({
      onSave: (k, llm) => { saved.push([k, llm]); },
      dismissable: true,
      currentKey: "soniox-key",
      currentLlmKey: "sk-openai",
    });
    const llmInput = document.querySelector("input[data-llm-key]") as HTMLInputElement;
    expect(llmInput).not.toBeNull();
    expect(llmInput.value).toBe("sk-openai");
    (document.querySelector("[data-action='save-key']") as HTMLElement).click();
    expect(saved).toEqual([["soniox-key", "sk-openai"]]);
  });

  it("saves with an empty llm key (polish off) — only the Soniox key is required", () => {
    const saved: Array<[string, string]> = [];
    openSettings({ onSave: (k, llm) => { saved.push([k, llm]); }, dismissable: true });
    const input = document.querySelector("[data-settings] input") as HTMLInputElement;
    input.value = "soniox-only";
    (document.querySelector("[data-action='save-key']") as HTMLElement).click();
    expect(saved).toEqual([["soniox-only", ""]]);
  });

  it("starts hidden and toggles key visibility with the eye button", () => {
    openSettings({ onSave: () => {}, dismissable: true, currentKey: "sk-secret" });
    const input = document.querySelector("[data-settings] input") as HTMLInputElement;
    const eye = document.querySelector("[data-action='toggle-reveal']") as HTMLElement;
    expect(eye).not.toBeNull();
    expect(input.type).toBe("password"); // masked by default
    eye.click();
    expect(input.type).toBe("text"); // revealed
    eye.click();
    expect(input.type).toBe("password"); // hidden again
  });
});
