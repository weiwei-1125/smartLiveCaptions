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
    if (text === "") {
      // empty live text → clear the live line
      if (this.current) {
        this.current = null;
        this.emit();
      }
      return;
    }
    if (!this.current) {
      this.current = { id: this.nextId++, source: text, translation: "", sourceLang: lang, done: false };
    } else {
      this.current.source = text;
      this.current.sourceLang = lang;
    }
    this.emit();
  }

  /** Set the live (in-progress) line with BOTH original and translation — used by the
   * streaming Soniox pipeline, where each grows token-by-token until the sentence commits. */
  setLive(source: string, translation: string, lang: "zh" | "en"): void {
    if (source === "" && translation === "") {
      if (this.current) {
        this.current = null;
        this.emit();
      }
      return;
    }
    if (!this.current) {
      this.current = { id: this.nextId++, source, translation, sourceLang: lang, done: false };
    } else {
      this.current.source = source;
      this.current.translation = translation;
      this.current.sourceLang = lang;
    }
    this.emit();
  }

  /** Append a finished sentence directly to history, independent of the live `current`
   * line. Returns its id so the async translation can be attached via setTranslation. */
  addFinal(text: string, lang: "zh" | "en"): number {
    const u: Utterance = {
      id: this.nextId++,
      source: text,
      translation: "",
      sourceLang: lang,
      done: true,
    };
    this.history.unshift(u);
    if (this.history.length > this.opts.maxHistory) this.history.length = this.opts.maxHistory;
    this.emit();
    return u.id;
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

  /** Append a streamed chunk of the colloquial-English polish line to a committed block.
   * Unknown ids (e.g. cleared history or a superseded session) are silently ignored. */
  appendPolish(id: number, delta: string): void {
    const u = this.history.find((x) => x.id === id);
    if (u) {
      u.polish = (u.polish ?? "") + delta;
      this.emit();
    }
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
