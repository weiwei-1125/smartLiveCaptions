// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderOverlay, type OverlayChrome } from "./overlay";
import { CaptionStore } from "../state/captionStore";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
});

function chrome(
  onTop = true,
  fontLevel = 1,
  statusKind: "ok" | "pending" | "error" = "ok",
): OverlayChrome {
  return { statusText: "已连接", onTop, fontLevel, statusKind, pace: "balanced" };
}

describe("renderOverlay", () => {
  it("renders drag handle, copy-all, clear, close (no mode/sensitivity controls)", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-drag]")).not.toBeNull();
    expect(root.querySelector("[data-action='copy-all']")).not.toBeNull();
    expect(root.querySelector("[data-action='clear']")).not.toBeNull();
    expect(root.querySelector("[data-action='close']")).not.toBeNull();
    // mode toggle + sensitivity segments are gone (Soniox auto two-way + auto endpointing)
    expect(root.querySelector("[data-action='toggle-mode']")).toBeNull();
    expect(root.querySelector("[data-action='set-level']")).toBeNull();
  });

  it("renders a settings (gear) button", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-action='open-settings']")).not.toBeNull();
  });

  it("renders the font A−/A+ stepper", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-action='font-smaller']")).not.toBeNull();
    expect(root.querySelector("[data-action='font-bigger']")).not.toBeNull();
  });

  it("renders the 断句节奏 (pace) segmented control with the active pace marked", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    const segs = root.querySelectorAll("[data-action='set-pace']");
    expect(segs.length).toBe(3);
    const active = root.querySelector("[data-action='set-pace'].active") as HTMLElement;
    expect(active.dataset.pace).toBe("balanced"); // chrome() default
  });

  it("disables A− at the smallest level and A+ at the largest", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(true, 0));
    expect((root.querySelector("[data-action='font-smaller']") as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector("[data-action='font-bigger']") as HTMLButtonElement).disabled).toBe(false);
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(true, 3));
    expect((root.querySelector("[data-action='font-bigger']") as HTMLButtonElement).disabled).toBe(true);
  });

  it("styles the status text by kind", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(true, 1, "error"));
    expect(root.querySelector(".status.status-error")).not.toBeNull();
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(true, 1, "ok"));
    expect(root.querySelector(".status.status-ok")).not.toBeNull();
  });

  it("shows a separate reconnect button when statusAction is set (text itself not clickable)", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), {
      statusText: "连接失败",
      statusKind: "error",
      statusAction: "reconnect",
      onTop: true,
      fontLevel: 1,
      pace: "balanced",
    });
    expect(root.querySelector("button[data-action='reconnect']")).not.toBeNull();
    expect(root.querySelector(".status[data-action]")).toBeNull(); // the text is not the button
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-action='reconnect']")).toBeNull();
  });

  it("renders window controls: pin, minimize, maximize, close", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-action='toggle-pin']")).not.toBeNull();
    expect(root.querySelector("[data-action='minimize']")).not.toBeNull();
    expect(root.querySelector("[data-action='toggle-maximize']")).not.toBeNull();
    expect(root.querySelector("[data-action='close']")).not.toBeNull();
  });

  it("reflects always-on-top state on the pin button", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(true));
    expect(root.querySelector("[data-action='toggle-pin']")!.classList.contains("active")).toBe(true);
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome(false));
    expect(root.querySelector("[data-action='toggle-pin']")!.classList.contains("active")).toBe(false);
  });

  it("renders history oldest-first then the live current block last", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    store.commit("第一句", "zh");
    store.commit("第二句", "zh");
    store.setPartial("正在说", "zh");
    renderOverlay(root, store, chrome());
    const blocks = [...root.querySelectorAll(".blk")];
    expect(blocks.length).toBe(3);
    expect(blocks[0].textContent).toContain("第一句"); // oldest at top
    expect(blocks[2].classList.contains("live")).toBe(true); // current at bottom
    expect(blocks[2].textContent).toContain("正在说");
  });

  it("colors Chinese originals zh and English originals en", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    store.commit("你好", "zh");
    store.commit("Hello", "en");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".orig.zh")).not.toBeNull();
    expect(root.querySelector(".orig.en")).not.toBeNull();
  });

  it("adds per-line copy buttons to committed lines but not the live line", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("你好", "zh");
    store.setTranslation(id, "Hello");
    store.setPartial("正在说", "zh"); // live line
    renderOverlay(root, store, chrome());
    const committed = root.querySelector(".blk:not(.live)")!;
    expect(committed.querySelector("[data-action='copy'][data-field='orig']")).not.toBeNull();
    expect(committed.querySelector("[data-action='copy'][data-field='trans']")).not.toBeNull();
    const live = root.querySelector(".blk.live")!;
    expect(live.querySelector("[data-action='copy']")).toBeNull();
  });

  it("renders a translation line only when a translation is present", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("你好", "zh");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".trans")).toBeNull();
    store.setTranslation(id, "Hello");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".trans")!.textContent).toContain("Hello");
  });

  it("renders the colloquial polish line (with copy) only when present", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("我想确认一下", "zh");
    store.setTranslation(id, "I want to confirm it.");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".polish")).toBeNull(); // nothing streamed yet
    store.appendPolish(id, "Just want to double-check.");
    renderOverlay(root, store, chrome());
    const polish = root.querySelector(".polish")!;
    expect(polish.textContent).toContain("Just want to double-check.");
    expect(polish.querySelector("[data-action='copy'][data-field='polish']")).not.toBeNull();
  });

  it("HTML-escapes transcript and translation text", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("<script>", "en");
    store.setTranslation(id, "a & b <x>");
    renderOverlay(root, store, chrome());
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.innerHTML).toContain("&lt;script&gt;");
    expect(root.innerHTML).toContain("a &amp; b &lt;x&gt;");
  });
});
