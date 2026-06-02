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
});
