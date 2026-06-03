import { describe, it, expect } from "vitest";
import { buildAccelerator } from "./accelerator";

const ev = (over: Partial<Parameters<typeof buildAccelerator>[0]> = {}) => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  code: "KeyM",
  ...over,
});

describe("buildAccelerator", () => {
  it("builds a modified letter combo (Ctrl+Alt+M)", () => {
    expect(buildAccelerator(ev({ ctrlKey: true, altKey: true, code: "KeyM" }))).toBe("Ctrl+Alt+M");
  });

  it("maps a modified digit", () => {
    expect(buildAccelerator(ev({ ctrlKey: true, altKey: true, code: "Digit1" }))).toBe("Ctrl+Alt+1");
  });

  it("allows a standalone Pause key", () => {
    expect(buildAccelerator(ev({ code: "Pause" }))).toBe("Pause");
  });

  it("allows a standalone function key", () => {
    expect(buildAccelerator(ev({ code: "F8" }))).toBe("F8");
  });

  it("requires a modifier for a bare letter/digit (too greedy alone)", () => {
    expect(buildAccelerator(ev({ code: "KeyM" }))).toBeNull();
    expect(buildAccelerator(ev({ code: "Digit1" }))).toBeNull();
    expect(buildAccelerator(ev({ code: "Space" }))).toBeNull();
  });

  it("returns null while only modifier keys are held (incomplete combo)", () => {
    expect(buildAccelerator(ev({ ctrlKey: true, code: "ControlLeft" }))).toBeNull();
    expect(buildAccelerator(ev({ altKey: true, code: "AltLeft" }))).toBeNull();
  });

  it("returns null for disallowed keys (Escape/Enter/Tab/arrows)", () => {
    expect(buildAccelerator(ev({ code: "Escape" }))).toBeNull();
    expect(buildAccelerator(ev({ ctrlKey: true, code: "Enter" }))).toBeNull();
    expect(buildAccelerator(ev({ altKey: true, code: "ArrowUp" }))).toBeNull();
  });

  it("orders modifiers Ctrl+Alt+Shift+Super", () => {
    expect(
      buildAccelerator(ev({ ctrlKey: true, altKey: true, shiftKey: true, metaKey: true, code: "KeyK" })),
    ).toBe("Ctrl+Alt+Shift+Super+K");
  });
});
