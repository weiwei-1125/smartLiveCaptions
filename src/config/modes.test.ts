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
  it("practice hints zh, interview hints en", () => {
    expect(transcriptionLangHint("practice")).toBe("zh");
    expect(transcriptionLangHint("interview")).toBe("en");
  });
});

describe("planUtterance", () => {
  it("practice + Chinese → translate to English", () => {
    expect(planUtterance("practice", "今天天气真不错")).toEqual({
      sourceLang: "zh",
      translateTo: "en",
    });
  });
  it("practice + English → passthrough (show only, no translation)", () => {
    expect(planUtterance("practice", "Hello there.")).toEqual({
      sourceLang: "en",
      translateTo: null,
    });
  });
  it("interview + English → translate to Chinese", () => {
    expect(planUtterance("interview", "Can you walk me through it?")).toEqual({
      sourceLang: "en",
      translateTo: "zh",
    });
  });
  it("interview + Chinese → passthrough (show only)", () => {
    expect(planUtterance("interview", "我先说一下")).toEqual({
      sourceLang: "zh",
      translateTo: null,
    });
  });
});
