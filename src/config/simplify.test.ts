import { describe, it, expect } from "vitest";
import { toSimplified } from "./simplify";

describe("toSimplified", () => {
  it("converts Traditional Chinese to Simplified", () => {
    expect(toSimplified("對不起")).toBe("对不起");
    expect(toSimplified("所以他怎麼辦呢？")).toBe("所以他怎么办呢？");
  });
  it("leaves English and already-simplified text unchanged", () => {
    expect(toSimplified("Hello there.")).toBe("Hello there.");
    expect(toSimplified("今天天气真不错")).toBe("今天天气真不错");
  });
});
