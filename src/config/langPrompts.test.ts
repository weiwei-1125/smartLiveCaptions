import { describe, it, expect } from "vitest";
import { langPairForMode, buildTranslationPrompt } from "./langPrompts";

describe("langPairForMode", () => {
  it("practice mode maps zh->en", () => {
    expect(langPairForMode("practice")).toEqual({ source: "zh", target: "en" });
  });
});

describe("buildTranslationPrompt", () => {
  it("asks for one natural spoken translation and includes the text", () => {
    const p = buildTranslationPrompt("这个会议改到下周三", { source: "zh", target: "en" });
    expect(p).toContain("这个会议改到下周三");
    expect(p.toLowerCase()).toContain("english");
    expect(p.toLowerCase()).toContain("natural");
  });
});
