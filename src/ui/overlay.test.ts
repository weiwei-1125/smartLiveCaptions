// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderOverlay, type OverlayChrome } from "./overlay";
import { CaptionStore } from "../state/captionStore";
import type { Mode } from "../types";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
});

function chrome(
  mode: Mode = "zh2en",
  level = "balanced",
  onTop = true,
  fontLevel = 1,
  statusKind: "ok" | "pending" | "error" = "ok",
): OverlayChrome {
  return { statusText: "已连接", mode, level, onTop, fontLevel, statusKind };
}

describe("renderOverlay", () => {
  it("renders drag handle, mode, sensitivity segments, copy-all, clear, close", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en"));
    expect(root.querySelector("[data-drag]")).not.toBeNull();
    expect(root.querySelectorAll("[data-action='set-level']").length).toBe(3); // 快/平衡/整句
    expect(root.querySelector("[data-action='copy-all']")).not.toBeNull();
    expect(root.querySelector("[data-action='clear']")).not.toBeNull();
    expect(root.querySelector("[data-action='close']")).not.toBeNull();
    const btn = root.querySelector("[data-action='toggle-mode']");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("中→英");
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

  it("disables A− at the smallest level and A+ at the largest", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", true, 0));
    expect((root.querySelector("[data-action='font-smaller']") as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector("[data-action='font-bigger']") as HTMLButtonElement).disabled).toBe(false);
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", true, 3));
    expect((root.querySelector("[data-action='font-bigger']") as HTMLButtonElement).disabled).toBe(true);
  });

  it("styles the status text by kind", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", true, 1, "error"));
    expect(root.querySelector(".status.status-error")).not.toBeNull();
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", true, 1, "ok"));
    expect(root.querySelector(".status.status-ok")).not.toBeNull();
  });

  it("renders window controls: pin, minimize, maximize, close", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome());
    expect(root.querySelector("[data-action='toggle-pin']")).not.toBeNull();
    expect(root.querySelector("[data-action='minimize']")).not.toBeNull();
    expect(root.querySelector("[data-action='toggle-maximize']")).not.toBeNull();
    expect(root.querySelector("[data-action='close']")).not.toBeNull();
  });

  it("reflects always-on-top state on the pin button", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", true));
    expect(root.querySelector("[data-action='toggle-pin']")!.classList.contains("active")).toBe(true);
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "balanced", false));
    expect(root.querySelector("[data-action='toggle-pin']")!.classList.contains("active")).toBe(false);
  });

  it("shows the en→zh direction when mode is en2zh", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("en2zh"));
    expect(root.querySelector("[data-action='toggle-mode']")!.textContent).toContain("英→中");
  });

  it("highlights the active sensitivity segment", () => {
    renderOverlay(root, new CaptionStore({ maxHistory: 5 }), chrome("zh2en", "full"));
    const active = root.querySelector(".seg-item.active")!;
    expect(active.getAttribute("data-level")).toBe("full");
    expect(active.textContent).toBe("整句");
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
    // committed block has an original-copy and a translation-copy button
    const committed = root.querySelector(".blk:not(.live)")!;
    expect(committed.querySelector("[data-action='copy'][data-field='orig']")).not.toBeNull();
    expect(committed.querySelector("[data-action='copy'][data-field='trans']")).not.toBeNull();
    // the live line has no copy buttons
    const live = root.querySelector(".blk.live")!;
    expect(live.querySelector("[data-action='copy']")).toBeNull();
  });

  it("renders a translation line only when a translation is present", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("你好", "zh");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".trans")).toBeNull(); // no translation yet
    store.setTranslation(id, "Hello");
    renderOverlay(root, store, chrome());
    expect(root.querySelector(".trans")!.textContent).toContain("Hello");
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
