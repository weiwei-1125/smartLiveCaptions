// Translation direction. zh2en: speak Chinese → English (English passthrough);
// en2zh: speak English → Chinese (Chinese passthrough).
export type Mode = "zh2en" | "en2zh";

export interface LangPair {
  source: "zh" | "en";
  target: "zh" | "en";
}

export interface Utterance {
  id: number;
  source: string;       // original transcript
  translation: string;  // translated text ("" until translated)
  polish?: string;      // optional colloquial-English rewrite (streams in after commit)
  sourceLang: "zh" | "en";
  done: boolean;        // true once the sentence is final
}

export type PcmFrame = Int16Array; // 16-bit PCM mono @ 24kHz (GA Realtime requires >=24kHz)
