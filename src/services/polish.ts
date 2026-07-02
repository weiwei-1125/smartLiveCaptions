// Colloquial-English polish service: per committed zh sentence, the Rust backend streams a
// natural spoken-English rewrite from an OpenAI-compatible endpoint. Off unless the user has
// configured their own OpenAI key (never bundled, same policy as the Soniox key).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function hasLlmKey(): Promise<boolean> {
  return await invoke<boolean>("has_llm_key");
}

/** The currently saved polish key (empty string if none) — prefills the settings panel. */
export async function getLlmKey(): Promise<string> {
  return await invoke<string>("get_llm_key");
}

/** Persist the user's own OpenAI polish key ("" clears it → feature off). */
export async function setLlmKey(key: string): Promise<void> {
  await invoke("set_llm_key", { key });
}

/** Mark this webview lifetime as the active polish session. Invalidates streams started by a
 * previous webview (a reload resets caption ids, so stale deltas must not attach to reused
 * ids). Call once at startup, before the first sentence can commit. */
export async function beginPolishSession(): Promise<void> {
  await invoke("begin_polish_session");
}

/** Kick off a streamed rewrite for the committed caption block `id`. Fire-and-forget:
 * results arrive via polish_delta / polish_done / polish_error events. */
export async function polishSentence(id: number, source: string, draft: string): Promise<void> {
  await invoke("polish_sentence", { id, source, draft });
}

export interface PolishDelta {
  id: number;
  text: string;
}

export function onPolishDelta(cb: (p: PolishDelta) => void): Promise<UnlistenFn> {
  return listen<PolishDelta>("polish_delta", (e) => cb(e.payload));
}

export function onPolishError(cb: (p: { id: number; msg: string }) => void): Promise<UnlistenFn> {
  return listen<{ id: number; msg: string }>("polish_error", (e) => cb(e.payload));
}
