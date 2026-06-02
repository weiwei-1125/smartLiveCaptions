// Turns the transcription's acoustic segments into linguistic SENTENCES:
//  - splits a segment on sentence-ending punctuation (。！？.!?…) so a long
//    continuously-spoken paragraph becomes one caption per sentence, and
//  - merges trailing incomplete text across segments so a sentence split by a
//    mid-sentence pause is rejoined, with
//  - backstops: flush the buffer after a silence (idleMs) or if it grows past
//    maxChars without punctuation (e.g. CJK transcription that omits punctuation).

const TERMINALS = "。！？!?…"; // sentence-ending marks (CJK + latin ! ?)
const TRAILERS = `)）」』""''】`; // closing marks that belong with the sentence
const WORD = /[A-Za-z0-9]/;

function isWordChar(c: string | undefined): boolean {
  return !!c && WORD.test(c);
}

/** A '.' that sits between two digits is a decimal point, not a sentence end. */
function isDecimalDot(text: string, i: number): boolean {
  return text[i] === "." && isWordCharDigit(text[i - 1]) && isWordCharDigit(text[i + 1]);
}
function isWordCharDigit(c: string | undefined): boolean {
  return !!c && /\d/.test(c);
}

/** Split text into complete sentences (ending in terminal punctuation) + a trailing remainder. */
export function splitSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const terminal = TERMINALS.includes(c) || (c === "." && !isDecimalDot(text, i));
    if (!terminal) continue;
    let j = i + 1;
    // swallow a run of terminal marks and any closing quotes/brackets
    while (j < text.length && (TERMINALS.includes(text[j]) || text[j] === "." || TRAILERS.includes(text[j]))) j++;
    const s = text.slice(start, j).trim();
    if (s) sentences.push(s);
    start = j;
    i = j - 1;
  }
  return { sentences, remainder: text.slice(start) };
}

function joinWithSpace(a: string, b: string): string {
  if (!a) return b;
  return isWordChar(a[a.length - 1]) && isWordChar(b[0]) ? a + " " + b : a + b;
}

export interface SentenceAssemblerOptions {
  idleMs: number;
  maxChars: number;
  onSentence: (text: string) => void;
}

export class SentenceAssembler {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private opts: SentenceAssemblerOptions) {}

  /** Ingest one finalized acoustic segment. Emits any complete sentences it forms. */
  feed(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.buffer = joinWithSpace(this.buffer, t);
    const { sentences, remainder } = splitSentences(this.buffer);
    // Set the remainder BEFORE emitting so onSentence handlers see the post-emit
    // buffer (peek() returns the in-progress remainder while rendering the live line).
    this.buffer = remainder;
    for (const s of sentences) this.opts.onSentence(s);
    if (this.buffer.length >= this.opts.maxChars) {
      this.flush();
      return;
    }
    this.arm();
  }

  /** Speech activity (a delta) — keep the idle flush from firing while still talking. */
  touch(): void {
    if (this.buffer) this.arm();
  }

  /** The in-progress (not yet sentence-final) text, for the live display line. */
  peek(): string {
    return this.buffer;
  }

  /** Emit whatever is buffered as a sentence (e.g. on idle/stop). */
  flush(): void {
    this.clearTimer();
    const s = this.buffer.trim();
    this.buffer = "";
    if (s) this.opts.onSentence(s);
  }

  /** Drop the buffer without emitting (e.g. on mode switch). */
  reset(): void {
    this.clearTimer();
    this.buffer = "";
  }

  /** Adjust the silence-hang timeout (sensitivity control). */
  setIdleMs(ms: number): void {
    this.opts.idleMs = ms;
  }

  private arm(): void {
    this.clearTimer();
    if (this.buffer) this.timer = setTimeout(() => this.flush(), this.opts.idleMs);
  }
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
