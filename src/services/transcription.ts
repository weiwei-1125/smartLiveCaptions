import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TranscriptMsg {
  kind: "partial" | "final";
  text: string;
}

export async function startTranscription(language: "zh" | "en"): Promise<void> {
  await invoke("start_transcription", { language });
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
