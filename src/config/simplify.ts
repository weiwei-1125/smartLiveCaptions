import { Converter } from "opencc-js";

// Traditional → Simplified Chinese (character-level OpenCC standard). English and
// already-simplified text pass through unchanged, so it's safe to run on any caption
// text — the transcription sometimes emits Traditional characters even with a zh hint.
const convert = Converter({ from: "t", to: "cn" });

export function toSimplified(text: string): string {
  return convert(text);
}
