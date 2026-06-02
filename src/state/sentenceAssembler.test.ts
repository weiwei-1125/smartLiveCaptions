import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splitSentences, SentenceAssembler } from "./sentenceAssembler";

describe("splitSentences", () => {
  it("splits a paragraph on CJK terminal punctuation", () => {
    const r = splitSentences("我特别能理解。我很清楚如何用人！那怎么办呢？");
    expect(r.sentences).toEqual(["我特别能理解。", "我很清楚如何用人！", "那怎么办呢？"]);
    expect(r.remainder).toBe("");
  });
  it("keeps an incomplete tail as remainder", () => {
    const r = splitSentences("你好。我想说");
    expect(r.sentences).toEqual(["你好。"]);
    expect(r.remainder).toBe("我想说");
  });
  it("splits English sentences but not decimals", () => {
    const r = splitSentences("It costs 3.5 dollars. That is fine.");
    expect(r.sentences).toEqual(["It costs 3.5 dollars.", "That is fine."]);
    expect(r.remainder).toBe("");
  });
  it("keeps internal commas within one sentence", () => {
    const r = splitSentences("你好啊，啥呀，做啥呢？");
    expect(r.sentences).toEqual(["你好啊，啥呀，做啥呢？"]);
  });
});

describe("SentenceAssembler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits a sentence per terminal punctuation", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("我特别能理解。我很清楚如何用人。");
    expect(out).toEqual(["我特别能理解。", "我很清楚如何用人。"]);
  });

  it("merges an incomplete fragment with the next segment", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("我想说"); // no terminal punctuation → held
    expect(out).toEqual([]);
    a.feed("这个方案不错。"); // completes the sentence
    expect(out).toEqual(["我想说这个方案不错。"]);
  });

  it("joins English fragments with a space", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("I think");
    a.feed("it's good.");
    expect(out).toEqual(["I think it's good."]);
  });

  it("flushes the buffer after idleMs of silence", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("没有标点的中文"); // held (no punctuation)
    expect(out).toEqual([]);
    vi.advanceTimersByTime(700);
    expect(out).toEqual(["没有标点的中文"]);
  });

  it("touch() resets the idle flush so speech in progress isn't cut", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("继续说");
    vi.advanceTimersByTime(500);
    a.touch(); // still talking
    vi.advanceTimersByTime(500);
    expect(out).toEqual([]); // not flushed yet (timer was reset)
    vi.advanceTimersByTime(200);
    expect(out).toEqual(["继续说"]);
  });

  it("force-flushes when the buffer exceeds maxChars without punctuation", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 10, onSentence: (s) => out.push(s) });
    a.feed("一二三四五六七八九十"); // 10 chars, no punctuation → force flush
    expect(out).toEqual(["一二三四五六七八九十"]);
  });

  it("reset() drops the buffer without emitting", () => {
    const out: string[] = [];
    const a = new SentenceAssembler({ idleMs: 700, maxChars: 160, onSentence: (s) => out.push(s) });
    a.feed("半句话");
    a.reset();
    vi.advanceTimersByTime(1000);
    expect(out).toEqual([]);
    expect(a.peek()).toBe("");
  });
});
