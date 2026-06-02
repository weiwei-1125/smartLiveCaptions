import type { Mode } from "../types";

/** Detect whether a transcript is Chinese (any Han char present) or English. */
export function detectLang(text: string): "zh" | "en" {
  // \p{Script=Han} covers the base block plus extensions/compat ideographs.
  return /\p{Script=Han}/u.test(text) ? "zh" : "en";
}

/** The language hint sent to the transcription session for each direction. */
export function transcriptionLangHint(mode: Mode): "zh" | "en" {
  return mode === "zh2en" ? "zh" : "en";
}

export interface UtterancePlan {
  /** Language of the spoken text, used for display coloring. */
  sourceLang: "zh" | "en";
  /** Target language to translate into, or null to show the original only. */
  translateTo: "zh" | "en" | null;
}

/**
 * Decide what to do with a finished utterance, per direction:
 * - zh2en: Chinese → translate to English; English → just show (no translation).
 * - en2zh: English → translate to Chinese; Chinese → just show.
 */
export function planUtterance(mode: Mode, text: string): UtterancePlan {
  const sourceLang = detectLang(text);
  if (mode === "zh2en") {
    return { sourceLang, translateTo: sourceLang === "zh" ? "en" : null };
  }
  return { sourceLang, translateTo: sourceLang === "en" ? "zh" : null };
}
