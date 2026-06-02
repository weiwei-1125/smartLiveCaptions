import type { Utterance } from "../types";

export interface CaptionStoreOptions {
  maxHistory: number;
}

export class CaptionStore {
  current: Utterance | null = null;
  history: Utterance[] = []; // newest first
  private nextId = 1;
  private subscribers: Array<() => void> = [];

  constructor(private opts: CaptionStoreOptions) {}

  subscribe(cb: () => void): void {
    this.subscribers.push(cb);
  }

  private emit(): void {
    for (const cb of this.subscribers) cb();
  }

  setPartial(text: string, lang: "zh" | "en"): void {
    if (!this.current) {
      this.current = { id: this.nextId++, source: text, translation: "", sourceLang: lang, done: false };
    } else {
      this.current.source = text;
      this.current.sourceLang = lang;
    }
    this.emit();
  }

  /** Finalizes the current utterance (or creates one from `finalText`) and moves it to history. Returns its id. */
  commit(finalText: string, lang: "zh" | "en" = "zh"): number {
    const u: Utterance = this.current
      ? { ...this.current, source: finalText, done: true }
      : { id: this.nextId++, source: finalText, translation: "", sourceLang: lang, done: true };
    this.current = null;
    this.history.unshift(u);
    if (this.history.length > this.opts.maxHistory) this.history.length = this.opts.maxHistory;
    this.emit();
    return u.id;
  }

  setTranslation(id: number, translation: string): void {
    const u = this.history.find((x) => x.id === id) ?? (this.current?.id === id ? this.current : null);
    if (u) {
      u.translation = translation;
      this.emit();
    }
  }

  /** Remove all captions (history + the live current line). */
  clear(): void {
    this.history = [];
    this.current = null;
    this.emit();
  }
}
