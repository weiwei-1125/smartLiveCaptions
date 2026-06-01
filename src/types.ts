export type Mode = "practice" | "interview";

export interface LangPair {
  source: "zh" | "en";
  target: "zh" | "en";
}

export interface Utterance {
  id: number;
  source: string;       // original transcript
  translation: string;  // translated text ("" until translated)
  sourceLang: "zh" | "en";
  done: boolean;        // true once the sentence is final
}

export type PcmFrame = Int16Array; // 16-bit PCM mono @ 24kHz (GA Realtime requires >=24kHz)
