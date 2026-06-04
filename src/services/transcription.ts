import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** A token from Soniox's result stream. */
export interface SonioxToken {
  text?: string;
  is_final?: boolean; // false = provisional/revisable, true = locked
  translation_status?: string; // "original" | "translation"
  language?: string;
  source_language?: string;
}
export interface SonioxResult {
  tokens?: SonioxToken[];
  finished?: boolean;
}

export async function startTranscription(): Promise<void> {
  await invoke("start_transcription");
}

export async function stopTranscription(): Promise<void> {
  await invoke("stop_transcription");
}

export async function pushAudio(pcm: Int16Array): Promise<void> {
  // Tauri serializes number[] to Vec<u8>; send raw little-endian PCM16 bytes.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  await invoke("push_audio", { pcm: Array.from(bytes) });
}

/** Each Soniox token-result message (final/non-final transcription + translation tokens). */
export function onSonioxResult(cb: (r: SonioxResult) => void): Promise<UnlistenFn> {
  return listen<SonioxResult>("soniox_result", (e) => cb(e.payload));
}

export function onConnError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("conn_error", (e) => cb(e.payload));
}

/** The link is up and configured (confirms "connected" / resets reconnect). */
export function onConnOpen(cb: () => void): Promise<UnlistenFn> {
  return listen("conn_open", () => cb());
}

/** The link ended unexpectedly (drop / sleep / server close) while still the active session. */
export function onConnLost(cb: () => void): Promise<UnlistenFn> {
  return listen("conn_lost", () => cb());
}
