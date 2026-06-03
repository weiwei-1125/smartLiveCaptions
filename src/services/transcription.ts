import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TranscriptMsg {
  kind: "partial" | "final";
  text: string;
}

export async function startTranscription(language: "zh" | "en", silenceMs: number): Promise<void> {
  await invoke("start_transcription", { language, silenceMs });
}

export async function stopTranscription(): Promise<void> {
  await invoke("stop_transcription");
}

export async function pushAudio(pcm: Int16Array): Promise<void> {
  // Tauri serializes number[] to Vec<u8>; send raw little-endian bytes.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  await invoke("push_audio", { pcm: Array.from(bytes) });
}

export function onTranscript(cb: (m: TranscriptMsg) => void): Promise<UnlistenFn> {
  return listen<TranscriptMsg>("transcript", (e) => cb(e.payload));
}

export function onConnError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<string>("conn_error", (e) => cb(e.payload));
}

/** The transcription link is up and configured (confirms "connected" / resets reconnect). */
export function onConnOpen(cb: () => void): Promise<UnlistenFn> {
  return listen("conn_open", () => cb());
}

/** The link ended unexpectedly (drop / sleep / server close) while still the active session. */
export function onConnLost(cb: () => void): Promise<UnlistenFn> {
  return listen("conn_lost", () => cb());
}
