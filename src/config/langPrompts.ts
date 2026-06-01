import type { LangPair } from "../types";

const LANG_NAME: Record<"zh" | "en", string> = { zh: "Chinese", en: "English" };

export function buildTranslationPrompt(text: string, pair: LangPair): string {
  const tgt = LANG_NAME[pair.target];
  return [
    `Translate the following ${LANG_NAME[pair.source]} sentence into one natural, idiomatic, spoken ${tgt} sentence.`,
    `Return ONLY the ${tgt} translation, no quotes, no explanation.`,
    ``,
    text,
  ].join("\n");
}
