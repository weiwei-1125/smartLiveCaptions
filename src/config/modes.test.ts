import { describe, it, expect } from "vitest";
import { detectLang, transcriptionLangHint, planUtterance } from "./modes";

describe("detectLang", () => {
  it("detects Chinese when any CJK character is present", () => {
    expect(detectLang("今天天气真不错")).toBe("zh");
    expect(detectLang("我想说 hello")).toBe("zh"); // mixed → treated as Chinese
  });
  it("detects English when there are no CJK characters", () => {
    expect(detectLang("Hello there.")).toBe("en");
    expect(detectLang("123 ok!")).toBe("en");
  });
});

describe("transcriptionLangHint", () => {
  it("zh2en hints zh, en2zh hints en", () => {
    expect(transcriptionLangHint("zh2en")).toBe("zh");
    expect(transcriptionLangHint("en2zh")).toBe("en");
  });
});

describe("planUtterance", () => {
  it("zh2en + Chinese → translate to English", () => {
    expect(planUtterance("zh2en", "今天天气真不错")).toEqual({
      sourceLang: "zh",
      translateTo: "en",
    });
  });
  it("zh2en + English → passthrough (show only, no translation)", () => {
    expect(planUtterance("zh2en", "Hello there.")).toEqual({
      sourceLang: "en",
      translateTo: null,
    });
  });
  it("en2zh + English → translate to Chinese", () => {
    expect(planUtterance("en2zh", "Can you walk me through it?")).toEqual({
      sourceLang: "en",
      translateTo: "zh",
    });
  });
  it("en2zh + Chinese → passthrough (show only)", () => {
    expect(planUtterance("en2zh", "我先说一下")).toEqual({
      sourceLang: "zh",
      translateTo: null,
    });
  });
});
