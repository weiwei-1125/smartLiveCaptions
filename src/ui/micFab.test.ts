// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createMicFab } from "./micFab";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mic FAB", () => {
  it("renders a floating mic button on the body", () => {
    const fab = createMicFab(() => {});
    expect(document.querySelector(".mic-fab")).not.toBeNull();
    expect(document.querySelector("[data-action='toggle-mic']")).not.toBeNull();
    fab.destroy();
  });

  it("calls onToggle when clicked", () => {
    let n = 0;
    const fab = createMicFab(() => n++);
    (document.querySelector(".mic-fab") as HTMLElement).click();
    expect(n).toBe(1);
    fab.destroy();
  });

  it("reflects mic on/off state with the right class", () => {
    const fab = createMicFab(() => {});
    fab.setMicOn(true);
    expect(fab.el.classList.contains("on")).toBe(true);
    expect(fab.el.classList.contains("off")).toBe(false);
    fab.setMicOn(false);
    expect(fab.el.classList.contains("off")).toBe(true);
    expect(fab.el.classList.contains("on")).toBe(false);
    fab.destroy();
  });

  it("shows voice activity only while the mic is on", () => {
    const fab = createMicFab(() => {});
    fab.setMicOn(true);
    fab.setVoiceActive(true);
    expect(fab.el.classList.contains("active")).toBe(true);
    fab.setVoiceActive(false);
    expect(fab.el.classList.contains("active")).toBe(false);
    // turning the mic off must clear the active glow
    fab.setVoiceActive(true);
    fab.setMicOn(false);
    expect(fab.el.classList.contains("active")).toBe(false);
    fab.destroy();
  });

  it("destroy removes it from the DOM", () => {
    const fab = createMicFab(() => {});
    fab.destroy();
    expect(document.querySelector(".mic-fab")).toBeNull();
  });
});
