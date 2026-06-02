import { describe, it, expect, vi } from "vitest";
import { CaptionStore } from "./captionStore";

describe("CaptionStore", () => {
  it("updates the live partial transcript", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("我在说", "zh");
    expect(s.current?.source).toBe("我在说");
    expect(s.current?.done).toBe(false);
  });

  it("commits the live utterance into history and clears current", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("第一句", "zh");
    const id = s.commit("第一句");
    expect(s.current).toBeNull();
    expect(s.history[0].id).toBe(id);
    expect(s.history[0].source).toBe("第一句");
    expect(s.history[0].done).toBe(true);
  });

  it("attaches a translation to a committed utterance by id", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.setPartial("你好", "zh");
    const id = s.commit("你好");
    s.setTranslation(id, "Hello");
    expect(s.history[0].translation).toBe("Hello");
  });

  it("caps history to maxHistory, dropping oldest", () => {
    const s = new CaptionStore({ maxHistory: 2 });
    s.commit("a"); s.commit("b"); s.commit("c");
    expect(s.history.map((u) => u.source)).toEqual(["c", "b"]); // newest first
  });

  it("notifies subscribers on change", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    const cb = vi.fn();
    s.subscribe(cb);
    s.setPartial("x", "zh");
    expect(cb).toHaveBeenCalled();
  });

  it("clear() empties history and current and notifies", () => {
    const s = new CaptionStore({ maxHistory: 3 });
    s.commit("a");
    s.setPartial("b", "zh");
    const cb = vi.fn();
    s.subscribe(cb);
    s.clear();
    expect(s.history).toEqual([]);
    expect(s.current).toBeNull();
    expect(cb).toHaveBeenCalled();
  });
});
