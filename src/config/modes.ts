import type { Mode } from "../types";

/** Detect whether a transcript is Chinese (any CJK char present) or English. */
export function detectLang(text: string): "zh" | "en" {
  return /[一-鿿]/.test(text) ? "zh" : "en";
}

/** The language hint sent to the transcription session for each mode. */
export function transcriptionLangHint(mode: Mode): "zh" | "en" {
  return mode === "practice" ? "zh" : "en";
}

export interface UtterancePlan {
  /** Language of the spoken text, used for display coloring. */
  sourceLang: "zh" | "en";
  /** Target language to translate into, or null to show the original only. */
  translateTo: "zh" | "en" | null;
}

/**
 * Decide what to do with a finished utterance, per mode:
 * - practice: Chinese → translate to English; English → just show (no translation).
 * - interview: English → translate to Chinese; Chinese → just show.
 */
export function planUtterance(mode: Mode, text: string): UtterancePlan {
  const sourceLang = detectLang(text);
  if (mode === "practice") {
    return { sourceLang, translateTo: sourceLang === "zh" ? "en" : null };
  }
  return { sourceLang, translateTo: sourceLang === "en" ? "zh" : null };
}
