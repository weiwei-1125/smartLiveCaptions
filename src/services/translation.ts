import { invoke } from "@tauri-apps/api/core";
import { buildTranslationPrompt } from "../config/langPrompts";
import type { LangPair } from "../types";

export async function translate(text: string, pair: LangPair): Promise<string> {
  const prompt = buildTranslationPrompt(text, pair);
  return await invoke<string>("translate", { prompt });
}
