// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderOverlay } from "./overlay";
import { CaptionStore } from "../state/captionStore";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
});

describe("renderOverlay", () => {
  it("renders a drag handle (data-drag) and a clickable mode button", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    renderOverlay(root, store, { statusText: "已连接", mode: "practice" });
    expect(root.querySelector("[data-drag]")).not.toBeNull();
    const btn = root.querySelector("[data-action='toggle-mode']");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("练口语");
  });

  it("shows the interview label when mode is interview", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    renderOverlay(root, store, { statusText: "x", mode: "interview" });
    expect(root.querySelector("[data-action='toggle-mode']")!.textContent).toContain("面试");
  });

  it("renders history oldest-first then the live current block last", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    store.commit("第一句", "zh");
    store.commit("第二句", "zh");
    store.setPartial("正在说", "zh");
    renderOverlay(root, store, { statusText: "x", mode: "practice" });
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
    renderOverlay(root, store, { statusText: "x", mode: "practice" });
    expect(root.querySelector(".orig.zh")).not.toBeNull();
    expect(root.querySelector(".orig.en")).not.toBeNull();
  });

  it("renders a translation line only when a translation is present", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("你好", "zh");
    renderOverlay(root, store, { statusText: "x", mode: "practice" });
    expect(root.querySelector(".trans")).toBeNull(); // no translation yet
    store.setTranslation(id, "Hello");
    renderOverlay(root, store, { statusText: "x", mode: "practice" });
    expect(root.querySelector(".trans")!.textContent).toContain("Hello");
  });

  it("HTML-escapes transcript and translation text", () => {
    const store = new CaptionStore({ maxHistory: 5 });
    const id = store.commit("<script>", "en");
    store.setTranslation(id, "a & b <x>");
    renderOverlay(root, store, { statusText: "x", mode: "practice" });
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.innerHTML).toContain("&lt;script&gt;");
    expect(root.innerHTML).toContain("a &amp; b &lt;x&gt;");
  });
});
