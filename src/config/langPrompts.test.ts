import { describe, it, expect } from "vitest";
import { buildTranslationPrompt } from "./langPrompts";

describe("buildTranslationPrompt", () => {
  it("asks for one natural spoken translation and includes the text", () => {
    const p = buildTranslationPrompt("这个会议改到下周三", { source: "zh", target: "en" });
    expect(p).toContain("这个会议改到下周三");
    expect(p.toLowerCase()).toContain("english");
    expect(p.toLowerCase()).toContain("natural");
  });

  it("supports the reverse direction (English → Chinese) for interview mode", () => {
    const p = buildTranslationPrompt("Can you walk me through it?", { source: "en", target: "zh" });
    expect(p).toContain("Can you walk me through it?");
    expect(p).toContain("Chinese");
  });
});
